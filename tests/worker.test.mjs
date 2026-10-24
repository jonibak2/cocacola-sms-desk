import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const origin = 'https://example.github.io';
const secret = 'server-only-test-secret';
const env = {SMSPOOL_API_KEY:secret, ALLOWED_ORIGIN:origin};
const request = (path, requestOrigin=origin) => new Request('https://proxy.example'+path,{
  method:'POST', headers:requestOrigin ? {Origin:requestOrigin} : {},
  body:new URLSearchParams({key:'client-key'})
});

test('public config supports Pages and never exposes the SMSPool credential',async()=>{
  const response = await worker.fetch(new Request('https://proxy.example/api/config',{headers:{Origin:origin}}),env);
  assert.deepEqual(await response.json(),{serverManaged:true});
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const unset = await worker.fetch(new Request('https://proxy.example/api/config'),{});
  assert.deepEqual(await unset.json(),{serverManaged:false});
  const foreign = await worker.fetch(new Request('https://proxy.example/api/config',{headers:{Origin:'https://other.example'}}),env);
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'),null);
});

test('anonymous requests use the server secret on both new and legacy routes',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls++;
    assert.equal(url,'https://api.smspool.net/request/balance');
    assert.equal(new URLSearchParams(init.body).get('key'),secret);
    return Response.json({balance:'5.00'});
  });
  for (const path of ['/api/request/balance','/request/balance']) {
    for (const requestOrigin of [origin,'https://proxy.example',null]) {
      const response=await worker.fetch(request(path,requestOrigin),env);
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{balance:'5.00'});
    }
  }
  assert.equal(calls,6);
});

test('secret mode needs no client API key, cookie, email or access token',async t=>{
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(new URLSearchParams(init.body).get('key'),secret);
    return Response.json({balance:'5.00'});
  });
  const req = new Request('https://proxy.example/api/request/balance',{method:'POST',headers:{Origin:origin},body:new URLSearchParams()});
  assert.equal((await worker.fetch(req,env)).status,200);
});

test('preflight works anonymously while endpoint and purchase restrictions remain',async t=>{
  t.mock.method(globalThis,'fetch',async()=>assert.fail('must not call upstream'));
  const preflight = await worker.fetch(new Request('https://proxy.example/api/request/balance',{method:'OPTIONS',headers:{Origin:origin}}),env);
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await worker.fetch(request('/api/purchase/sms'),env)).status,400);
  assert.equal((await worker.fetch(request('/api/purchase/rental'),env)).status,404);
  assert.equal((await worker.fetch(request('/api/request/balance','https://other.example'),env)).status,403);
});

test('upstream errors cannot echo the account secret to visitors',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({success:0,message:'Invalid key: '+secret},{status:401}));
  const response=await worker.fetch(request('/api/request/balance'),env);
  assert.equal(response.status,401);
  const body=await response.text();
  assert.equal(body.includes(secret),false);
  assert.equal(JSON.parse(body).message,'Invalid key: [redacted]');
});

test('Worker serves the app without login and preserves its security headers',async()=>{
  const response=await worker.fetch(new Request('https://proxy.example/'),{...env,ASSETS:{fetch:async()=>new Response('<!doctype html><title>SMS Desk</title>')}});
  assert.equal(response.status,200);
  assert.match(await response.text(),/SMS Desk/);
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
});
