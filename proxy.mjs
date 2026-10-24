const allowedEndpoints = new Set(['/request/balance','/request/price','/request/history','/request/active','/sms/check','/sms/cancel','/purchase/sms']);
const securityHeaders = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' };
const failure = (message,status,headers) => Response.json({success:0,message},{status,headers:{...securityHeaders,...headers}});
export async function handleProxy(request, { allowedOrigins = [], fetcher = fetch, serverKey } = {}) {
  const origin = request.headers.get('Origin');
  const allowed = origin && allowedOrigins.includes(origin);
  const cors = allowed ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'} : {};
  if (origin && !allowed) return failure('Origin is not allowed. Configure ALLOWED_ORIGIN.',403,{});
  const url = new URL(request.url); const path = url.pathname.replace(/^\/api(?=\/)/,'');
  if (!allowedEndpoints.has(path)) return failure('Endpoint not found',404,cors);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  if (request.method !== 'POST') return failure('POST required',405,cors);
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return failure('Form body required',415,cors);
  const content = await request.text(); if (content.length > 8192) return failure('Request too large',413,cors);
  const form = new URLSearchParams(content);
  if (serverKey) form.set('key',serverKey);
  const key = form.get('key');
  if (!key || key.length > 256 || /[\r\n]/.test(key)) return failure('Invalid API key',401,cors);
  if (path === '/purchase/sms') {
    if (form.get('country') !== 'IL' || form.get('service') !== '1244' || form.get('quantity') !== '1') return failure('Only one Israel CocaCola number is supported',400,cors);
  }
  try {
    const response = await fetcher('https://api.smspool.net'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:form.toString(),redirect:'manual',signal:AbortSignal.timeout(40000)});
    if (response.status >= 300 && response.status < 400) return failure('Unexpected SMSPool redirect. Check order history before purchasing again.',502,cors);
    let body = await response.text();
    try { JSON.parse(body); } catch { return failure('SMSPool returned an invalid response. Check order history before purchasing again.',502,cors); }
    // Keep the server credential private even if an upstream error echoes it.
    if (serverKey) body = body.split(JSON.stringify(serverKey).slice(1,-1)).join('[redacted]');
    return new Response(body,{status:response.status,headers:{...securityHeaders,...cors,'Content-Type':'application/json; charset=utf-8'}});
  } catch { return failure('SMSPool did not respond. Check order history before purchasing again.',502,cors); }
}
