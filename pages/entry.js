// Expose the app and API on pages.dev. The account secret stays in the Worker.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        // Service bindings invoke the Worker internally, without workers.dev DNS.
        return await env.SMSPOOL_PROXY.fetch(request);
      } catch {
        return Response.json({success:0,message:'The API service is unavailable. Try again shortly.'},{status:502,headers:{'Cache-Control':'no-store'}});
      }
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body,asset);
    response.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('X-Content-Type-Options','nosniff');
    return response;
  }
};
