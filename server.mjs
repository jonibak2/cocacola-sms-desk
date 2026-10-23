import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { handleProxy } from './proxy.mjs';

const port = Number(process.env.PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const files = new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/model.js','model.js'],['/styles.css','styles.css']]);
const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
const server = createServer(async(req,res) => {
  const url = new URL(req.url,origin);
  try {
    if (url.pathname.startsWith('/api/')) {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 8192) { res.writeHead(413); res.end(); return; } }
      const request = new Request(origin+url.pathname,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method) ? {body} : {})});
      const result = await handleProxy(request,{allowedOrigins:[origin,`http://localhost:${port}`]});
      res.writeHead(result.status,Object.fromEntries(result.headers)); res.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const file = files.get(url.pathname);
    if (!file || !['GET','HEAD'].includes(req.method)) {res.writeHead(404);res.end('Not found');return;}
    const content = await readFile(fileURLToPath(new URL('./public/'+file,import.meta.url)));
    res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"}); res.end(req.method === 'HEAD' ? '' : content);
  } catch { res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Ошибка сервера'); }
});
server.listen(port,'127.0.0.1',() => console.log(`SMS Desk: ${origin}`));
