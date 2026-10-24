const certificates = new Map();
const decode = value => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), c => c.charCodeAt(0));

// Validate Access at the origin as well as at the edge. A spoofed header alone
// must never unlock the server-side SMSPool credential.
export async function verifyAccess(request, env, fetcher = fetch) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').replace(/\/$/, '');
  const audience = env.ACCESS_AUD;
  const email = String(env.ACCESS_ALLOWED_EMAIL || '').toLowerCase();
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team) || !audience || !email) {
    throw new Error('Access is not configured');
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  if (token.length > 16384 || token.split('.').length !== 3) throw new Error('Access login required');
  const [head, body, signature] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(decode(head)));
  const claims = JSON.parse(new TextDecoder().decode(decode(body)));
  const now = Date.now() / 1000;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== team ||
      !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
      typeof claims.exp !== 'number' || claims.exp <= now ||
      (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now)) ||
      String(claims.email || '').toLowerCase() !== email) throw new Error('Access login required');
  let cached = certificates.get(team);
  if (!cached || cached.until < Date.now() || !cached.keys.some(k => k.kid === header.kid)) {
    const response = await fetcher(team + '/cdn-cgi/access/certs', {redirect:'manual',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw new Error('Access verification unavailable');
    const data = await response.json();
    if (!Array.isArray(data.keys)) throw new Error('Access verification unavailable');
    cached = {keys:data.keys,until:Date.now()+300000}; certificates.set(team,cached);
  }
  const jwk = cached.keys.find(k => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('Access login required');
  const key = await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(signature),new TextEncoder().encode(head+'.'+body))) throw new Error('Access login required');
  return claims;
}
