import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../public/model.js';

const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8'))
  .replace(/^import[^\n]+\n/,'')
  .replace('initializeAccount().catch(', 'globalThis.ready = initializeAccount().catch(');

for(const hostname of ['jonibak2.github.io','cocacola-sms-proxy.jonibak2006.workers.dev']) {
  test('automatic secret-mode connection without a browser key on '+hostname,async()=>{
    const elements=new Map(), stored=new Map([['smsdesk.session',JSON.stringify({key:'old-browser-test-key'})]]);
    const element=id=>{
      if(!elements.has(id)) elements.set(id,{
        classList:{add(){},remove(){},toggle(){}},style:{},dataset:{},
        lastElementChild:{},closest:()=>element(id+'-label'),
        addEventListener(){},setAttribute(){},getBoundingClientRect:()=>({height:40})
      });
      return elements.get(id);
    };
    const requests=[];
    const browserStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
    const context=vm.createContext({
      ...model,location:{hostname,origin:'https://'+hostname},crypto,
      document:{getElementById:element,querySelectorAll:()=>[],querySelector:element,addEventListener(){},body:element('body')},
      localStorage:browserStorage,sessionStorage:browserStorage,
      getComputedStyle:()=>({getPropertyValue:()=>'',minHeight:'300px'}),
      ResizeObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){},setInterval(){},
      URL,URLSearchParams,AbortSignal,TextEncoder,
      fetch:async(url,init={})=>{
        requests.push({url,body:init.body ? new URLSearchParams(init.body) : null});
        if(url.endsWith('/api/config')) return Response.json({serverManaged:true});
        if(url.endsWith('/request/balance')) return Response.json({balance:'5.00'});
        if(url.endsWith('/request/price')) return Response.json({price:'.37'});
        if(url.endsWith('/request/history')||url.endsWith('/request/active')) return Response.json([]);
        assert.fail('Unexpected request '+url);
      }
    });
    vm.runInContext(source,context);
    await context.ready;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(vm.runInContext('connected && serverManaged',context),true);
    assert.equal(element('api-key').required,false);
    assert.equal(element('api-key-label').hidden,true);
    assert.equal(stored.has('smsdesk.session'),false);
    assert.equal(requests.some(req=>req.url.endsWith('/request/balance')),true);
    assert.equal(requests.some(req=>req.body?.has('key')),false);
    assert.equal(requests.some(req=>req.url.includes('/api/session')),false);
    assert.equal(element('balance').textContent,'$5.00');
  });
}
