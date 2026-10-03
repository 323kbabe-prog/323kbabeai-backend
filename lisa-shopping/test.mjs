import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,normalize,validate,safeUrl} from './server.mjs';
const rows=Array.from({length:14},(_,i)=>({product_id:String(i),title:`Product ${i}`,extracted_price:100+i,price:`NT$${100+i}`,product_link:`https://example.com/products/${i}`,source:'Store',reviews:i*10,rating:4}));
test('ten unique results ranked by review count with safe links and strict prices',()=>{
 const items=normalize([...rows,rows[0],{...rows[0],product_id:'unsafe',product_link:'javascript:alert(1)'}],{min:102,max:112});
 assert.equal(items.length,10);assert.equal(items[0].id,'12');assert.ok(items.every(x=>x.price>=102&&x.price<=112));assert.equal(new Set(items.map(x=>x.id)).size,10);assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('https://user:pass@example.com'),null);
});
test('invalid searches and ranges rejected',()=>{assert.throws(()=>validate({q:' '}));assert.throws(()=>validate({q:'shoe',min:2,max:1}));assert.throws(()=>validate({q:'shoe',min:'1'}));assert.equal(validate({q:' shoes ',country:'bad'}).country,'tw');});
test('HTTP search, cache, price controls, CORS, and unavailable source',async()=>{
 let calls=0,lastUrl;const app=createApp({apiKey:'test-only',fetcher:async url=>{calls++;lastUrl=url;return {ok:true,json:async()=>({shopping_results:rows})};}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const send=(data,origin='https://lisa-shopping.a078bc.chatgpt.site')=>fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});
 try{
  assert.equal((await (await fetch(base+'/health')).json()).searchReady,true);
  let res=await send({q:'shoes',country:'tw'});assert.equal(res.status,200);assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://lisa-shopping.a078bc.chatgpt.site');const first=await res.json();assert.equal(first.products.length,10);
  await send({q:'shoes',country:'tw'});assert.equal(calls,1);
  const high=Math.max(...first.products.map(p=>p.price));res=await send({q:'shoes',country:'tw',min:high+.01});const higher=await res.json();assert.ok(higher.products.every(p=>p.price>high));assert.equal(lastUrl.searchParams.get('sort_by'),'1');assert.equal(lastUrl.searchParams.get('min_price'),String(high+.01));
  const low=Math.min(...first.products.map(p=>p.price));res=await send({q:'shoes',country:'tw',max:low-.01});const lower=await res.json();assert.ok(lower.products.every(p=>p.price<low));assert.equal(lastUrl.searchParams.get('sort_by'),'2');
  assert.equal((await send({q:'shoe'},'https://untrusted.example')).status,403);assert.equal((await send({q:'shoe',min:-1})).status,400);
 }finally{await new Promise(r=>app.close(r));}
 const unconfigured=createApp({apiKey:''});await new Promise(r=>unconfigured.listen(0,'127.0.0.1',r));try{const r=await fetch(`http://127.0.0.1:${unconfigured.address().port}/api/search`,{method:'POST',body:'{"q":"shoe"}'});assert.equal(r.status,503);assert.equal((await r.json()).code,'NOT_CONFIGURED');}finally{await new Promise(r=>unconfigured.close(r));}
});
