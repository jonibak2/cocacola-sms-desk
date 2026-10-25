import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';

const source = new URL('../public/',import.meta.url);
const output = new URL('../.pages-dist/',import.meta.url);
await mkdir(output,{recursive:true});
await cp(source,output,{recursive:true});
const html = await readFile(new URL('index.html',output),'utf8');
await writeFile(new URL('index.html',output),html.replace('<head>','<head><meta name="smsdesk-api" content="same-origin">'));
await cp(new URL('entry.js',import.meta.url),new URL('_worker.js',output));
await writeFile(new URL('_routes.json',output),JSON.stringify({version:1,include:['/*'],exclude:[]}));
console.log('Built Pages site with an internal API binding. No secrets are included.');
