import { handleProxy } from '../proxy.mjs';
import { verifyAccess } from './access.js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigins = [url.origin,...String(env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)];
    const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
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
    let identity;
    if (env.SMSPOOL_API_KEY && request.method !== 'OPTIONS') {
      try { identity = await verifyAccess(request,env); }
      catch { return json({success:0,message:'Sign in through Cloudflare Access. Configure ACCESS_TEAM_DOMAIN, ACCESS_AUD and ACCESS_ALLOWED_EMAIL before using Secrets.'},401); }
    }
    if (url.pathname === '/api/session' && request.method === 'GET') {
      if (!env.SMSPOOL_API_KEY || !identity) return json({success:0,message:'Server secret is not configured'},503);
      return json({authenticated:true});
    }
    return handleProxy(request,{allowedOrigins,serverKey:env.SMSPOOL_API_KEY,authorized:Boolean(identity)});
  }
};
