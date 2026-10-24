import { handleProxy } from '../proxy.mjs';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigins = [url.origin,...String(env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)];
    const origin = request.headers.get('Origin');
    const cors = origin && allowedOrigins.includes(origin) ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin'} : {};
    const json = (data,status=200) => Response.json(data,{status,headers:{...cors,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    if (url.pathname === '/api/config' && request.method === 'GET') return json({serverManaged:Boolean(env.SMSPOOL_API_KEY)});
    const isApi = url.pathname.startsWith('/api/') || /^\/(request|sms|purchase)\//.test(url.pathname);
    if (!isApi) {
      if (!env.ASSETS) return json({message:'Not found'},404);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body,asset);
      response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      response.headers.set('Referrer-Policy','no-referrer');
      return response;
    }
    return handleProxy(request,{allowedOrigins,serverKey:env.SMSPOOL_API_KEY});
  }
};
