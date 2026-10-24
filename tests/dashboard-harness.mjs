import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../public/model.js';

const source=(await readFile(new URL('../public/app.js',import.meta.url),'utf8'))
  .replace(/^import[^\n]+\n/,'')
  .replace('initializeAccount().catch(', 'globalThis.ready = initializeAccount().catch(');

export async function dashboard() {
  const elements=new Map(), stored=new Map(), requests=[], copied=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{
      classList:{add(){},remove(){},toggle(){}},style:{},dataset:{},attributes:{},listeners:{},lastElementChild:{},
      closest:()=>element(id+'-label'),
      addEventListener(name,callback){this.listeners[name]=callback;},
      setAttribute(name,value){this.attributes[name]=value;},
      getBoundingClientRect:()=>({height:40}),
      showModal(){this.open=true;},
      close(value){this.open=false;if(value!==undefined)this.returnValue=value;this.listeners.close?.();}
    });
    return elements.get(id);
  };
  const browserStorage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)};
  const context=vm.createContext({
    ...model,location:{hostname:'proxy.example',origin:'https://proxy.example'},crypto,
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:element,addEventListener(){},body:element('body'),documentElement:element('html')},
    localStorage:browserStorage,sessionStorage:browserStorage,
    navigator:{clipboard:{writeText:async text=>copied.push(text)}},
    getComputedStyle:()=>({getPropertyValue:()=>'',minHeight:'300px'}),
    ResizeObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){},setInterval(){},
    URL,URLSearchParams,AbortSignal,TextEncoder,
    fetch:async(url,init={})=>{
      requests.push({url,body:init.body ? new URLSearchParams(init.body) : null});
      if(url.endsWith('/api/config')) return Response.json({serverManaged:true});
      if(url.endsWith('/request/balance')) return Response.json({balance:'5.00'});
      if(url.endsWith('/request/price')) return Response.json({price:'.37'});
      if(url.endsWith('/request/history')||url.endsWith('/request/active')) return Response.json([]);
      if(url.endsWith('/purchase/sms')) return Response.json({order_id:'new',number:'972539000123',cost:'.37'});
      if(url.endsWith('/sms/cancel')) return Response.json({success:1});
      assert.fail('Unexpected request '+url);
    }
  });
  vm.runInContext(source,context);
  await context.ready;
  await new Promise(resolve=>setImmediate(resolve));
  return {element,requests,copied,run:code=>vm.runInContext(code,context)};
}
