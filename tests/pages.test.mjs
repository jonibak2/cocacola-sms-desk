import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../pages/entry.js';
import worker from '../worker/index.js';

test('Pages connects to the existing secret through a service binding without workers.dev requests',async t=>{
  const origin='https://cocacola-sms-desk.pages.dev';
  let serviceCalls=0, upstreamCalls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    upstreamCalls++;
    assert.equal(url,'https://api.smspool.net/request/balance');
    assert.equal(new URLSearchParams(init.body).get('key'),'server-test-secret');
    return Response.json({balance:'5.00'});
  });
  const env={SMSPOOL_PROXY:{fetch:request=>{
    serviceCalls++;
    assert.equal(new URL(request.url).origin,origin);
    return worker.fetch(request,{SMSPOOL_API_KEY:'server-test-secret'});
  }}};
  const config=await gateway.fetch(new Request(origin+'/api/config'),env);
  assert.deepEqual(await config.json(),{serverManaged:true});
  const response=await gateway.fetch(new Request(origin+'/api/request/balance',{method:'POST',headers:{Origin:origin},body:new URLSearchParams()}),env);
  assert.deepEqual(await response.json(),{balance:'5.00'});
  assert.equal(serviceCalls,2);
  assert.equal(upstreamCalls,1);
});

test('Pages forwards GitHub preflights and API calls with their CORS headers',async t=>{
  const origin='https://jonibak2.github.io';
  t.mock.method(globalThis,'fetch',async()=>Response.json({balance:'5.00'}));
  const env={SMSPOOL_PROXY:{fetch:request=>worker.fetch(request,{SMSPOOL_API_KEY:'server-test-secret',ALLOWED_ORIGIN:origin})}};
  for(const method of ['OPTIONS','POST']) {
    const response=await gateway.fetch(new Request('https://cocacola-sms-desk.pages.dev/api/request/balance',{method,headers:{Origin:origin},...(method==='POST'?{body:new URLSearchParams()}: {})}),env);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
    assert.equal(response.status,method==='OPTIONS'?204:200);
  }
});

test('missing service binding returns a useful error instead of leaking an exception',async()=>{
  const response=await gateway.fetch(new Request('https://app.pages.dev/api/config'),{});
  assert.equal(response.status,502);
  assert.equal((await response.json()).success,0);
});

test('Pages serves its own assets with same-origin API policy',async()=>{
  const response=await gateway.fetch(new Request('https://app.pages.dev/'),{ASSETS:{fetch:async()=>new Response('<title>SMS Desk</title>')}});
  assert.equal(response.status,200);
  assert.match(await response.text(),/SMS Desk/);
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
});
