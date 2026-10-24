import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAccess} from '../worker/access.js';
import worker from '../worker/index.js';
import {handleProxy} from '../proxy.mjs';

const env = {ACCESS_TEAM_DOMAIN:'https://smsdesk-tests.cloudflareaccess.com',ACCESS_AUD:'test-audience',ACCESS_ALLOWED_EMAIL:'owner@example.com'};
const b64 = value => Buffer.from(value).toString('base64url');
const pair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk = {...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
const now = Math.floor(Date.now()/1000);
async function jwt(changes={}) {
  const head=b64(JSON.stringify({alg:'RS256',kid:'test-key'}));
  const body=b64(JSON.stringify({iss:env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],email:env.ACCESS_ALLOWED_EMAIL,nbf:now-10,exp:now+300,...changes}));
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(head+'.'+body));
  return head+'.'+body+'.'+b64(signature);
}
const request = token => new Request('https://proxy.example/api/request/balance',{headers:{'Cf-Access-Jwt-Assertion':token}});
const certs = async url => {assert.equal(url,env.ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};

test('valid Access signature, issuer, audience and owner email are required',async()=>{
  const token=await jwt();assert.equal((await verifyAccess(request(token),env,certs)).email,env.ACCESS_ALLOWED_EMAIL);
  assert.equal((await verifyAccess(request(await jwt({nbf:undefined})),env,certs)).email,env.ACCESS_ALLOWED_EMAIL);
  for(const changes of [{iss:'https://attacker.example'},{aud:['other-app']},{email:'other@example.com'},{exp:now-1},{nbf:now+3600}]) await assert.rejects(verifyAccess(request(await jwt(changes)),env,certs));
  const parts=token.split('.');parts[1]=b64(JSON.stringify({iss:env.ACCESS_TEAM_DOMAIN,aud:[env.ACCESS_AUD],email:env.ACCESS_ALLOWED_EMAIL,nbf:now-10,exp:now+9999}));
  await assert.rejects(verifyAccess(request(parts.join('.')),env,certs));
  await assert.rejects(verifyAccess(request('fake.header.signature'),env,certs));
});
test('missing Access configuration and spoofed identity headers cannot unlock a secret',async()=>{
  const secretEnv={SMSPOOL_API_KEY:'server-test-secret',ALLOWED_ORIGIN:'https://example.github.io'};
  const req=new Request('https://proxy.example/api/request/balance',{method:'POST',headers:{Origin:'https://example.github.io','Cf-Access-Authenticated-User-Email':'owner@example.com'},body:new URLSearchParams({key:'client-key'})});
  const response=await worker.fetch(req,secretEnv);assert.equal(response.status,401);assert.equal((await response.text()).includes(secretEnv.SMSPOOL_API_KEY),false);
  assert.equal((await worker.fetch(request('fake'),{...secretEnv,...env})).status,401);
});
test('server credential replaces client input only after authorization',async()=>{
  const make=()=>new Request('https://proxy.example/api/request/balance',{method:'POST',headers:{Origin:'https://example.github.io'},body:new URLSearchParams({key:'attacker-supplied-key'})});
  const options={allowedOrigins:['https://example.github.io'],serverKey:'server-test-secret',fetcher:async(url,init)=>{assert.equal(new URLSearchParams(init.body).get('key'),'server-test-secret');return Response.json({balance:'5.00'});}};
  assert.equal((await handleProxy(make(),options)).status,401);
  const response=await handleProxy(make(),{...options,authorized:true});assert.equal(response.status,200);assert.equal((await response.text()).includes('server-test-secret'),false);
});
test('public configuration never contains keys and protected session requires Access',async()=>{
  const secretEnv={SMSPOOL_API_KEY:'server-test-secret'};
  const response=await worker.fetch(new Request('https://proxy.example/api/config'),secretEnv);assert.deepEqual(await response.json(),{serverManaged:true});
  assert.equal((await worker.fetch(new Request('https://proxy.example/api/session'),secretEnv)).status,401);
  const legacy=await worker.fetch(new Request('https://proxy.example/api/config'),{});assert.deepEqual(await legacy.json(),{serverManaged:false});
});
test('authenticated Worker injects its secret and rejects cross-origin use',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,'https://api.smspool.net/request/balance');
    assert.equal(new URLSearchParams(init.body).get('key'),'server-test-secret');
    calls++;return Response.json({balance:'5.00'});
  });
  const token=await jwt();
  const make=origin=>new Request('https://proxy.example/api/request/balance',{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':token},body:new URLSearchParams({key:'client-key'})});
  const secretEnv={...env,SMSPOOL_API_KEY:'server-test-secret'};
  const response=await worker.fetch(make('https://proxy.example'),secretEnv);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{balance:'5.00'});assert.equal(calls,1);
  const rejected=await worker.fetch(make('https://other.example'),secretEnv);assert.equal(rejected.status,403);assert.equal(calls,1);
});
