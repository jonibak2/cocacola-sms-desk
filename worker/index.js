import { handleProxy } from '../proxy.mjs';
export default {
  async fetch(request, env) {
    const allowedOrigins = String(env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
    return handleProxy(request,{allowedOrigins});
  }
};
