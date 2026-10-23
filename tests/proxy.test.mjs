import test from 'node:test';
import assert from 'node:assert/strict';
import {handleProxy} from '../proxy.mjs';
const origin = 'https://example.github.io';
function request(path,params={},requestOrigin=origin) { return new Request('https://proxy.example'+path,{method:'POST',headers:{Origin:requestOrigin},body:new URLSearchParams({key:'test-key',...params})}); }
test('proxy forwards form data only to the fixed SMSPool API and sets CORS',async() => {
  let calls = 0;
  const response = await handleProxy(request('/request/balance'),{allowedOrigins:[origin],fetcher:async(url,options) => { calls++; assert.equal(url,'https://api.smspool.net/request/balance'); assert.equal(new URLSearchParams(options.body).get('key'),'test-key'); assert.equal(options.redirect,'error'); return Response.json({balance:'5.00'}); }});
  assert.equal(calls,1); assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin); assert.equal(response.headers.get('Cache-Control'),'no-store'); assert.deepEqual(await response.json(),{balance:'5.00'});
});
test('proxy rejects foreign origins and unknown endpoints without upstream requests',async() => {
  const options = {allowedOrigins:[origin],fetcher:async() => assert.fail('must not call upstream')};
  assert.equal((await handleProxy(request('/request/balance',{},'https://evil.example'),options)).status,403);
  assert.equal((await handleProxy(request('/purchase/rental'),options)).status,404);
  assert.equal((await handleProxy(request('/purchase/sms',{country:'US',service:'1244',quantity:1}),options)).status,400);
});
test('purchase sends exactly one CocaCola Israel order and never retries an ambiguous failure',async() => {
  let calls=0;
  const response=await handleProxy(request('/purchase/sms',{country:'IL',service:'1244',quantity:1,max_price:'.40'}),{allowedOrigins:[origin],fetcher:async(url,options) => { calls++; assert.equal(new URLSearchParams(options.body).get('max_price'),'.40'); throw new Error('Timeout'); }});
  assert.equal(calls,1);assert.equal(response.status,502);assert.match((await response.json()).message,/history/);
});
test('upstream authentication errors and rate limits retain their status',async() => {
  for (const status of [401,403,429]) { const response=await handleProxy(request('/request/active'),{allowedOrigins:[origin],fetcher:async() => Response.json({success:0},{status})}); assert.equal(response.status,status); }
});
test('HTML upstream error becomes a structured 502',async() => {
  const response=await handleProxy(request('/purchase/sms',{country:'IL',service:'1244',quantity:1}),{allowedOrigins:[origin],fetcher:async() => new Response('<html>Error</html>',{status:502})}); assert.equal(response.status,502);assert.equal((await response.json()).success,0);
});
test('preflight permits only the configured origin',async() => {
  const response=await handleProxy(new Request('https://proxy.example/request/balance',{method:'OPTIONS',headers:{Origin:origin}}),{allowedOrigins:[origin]});assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
});
