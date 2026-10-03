import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp,validate,safeUrl} from './server.mjs';
import {parseResearch} from './gpt-search.mjs';
const rows=Array.from({length:12},(_,i)=>({title:`Product ${i}`,price:100+i,currency:'TWD',store:'Store',url:`https://example.com/products/${i}`,image:null,rating:null,reviews:null,reason:'Matches the request.',popularity:'Included in a published recommendation.',priceSource:`https://example.com/products/${i}`,popularitySource:'https://example.com/recommendations'}));
function response(products=rows){return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{type:'search',sources:[...rows.map(p=>({url:p.url,title:p.title})),{url:'https://example.com/recommendations',title:'Recommendations'}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({country:'tw',currency:'TWD',products})}]}]};}
test('ten distinct sourced products; uncited links, currency errors and out-of-range prices excluded',()=>{
 const products=parseResearch(response([...rows,rows[0]]),{q:'shoe',location:'Taipei, Taiwan',country:'tw'}).products;assert.equal(products.length,10);assert.equal(new Set(products.map(p=>p.id)).size,10);assert.equal(products[0].sources.length,2);
 const filtered=parseResearch(response([{...rows[0],url:'https://fabricated.example'}, {...rows[1],currency:'USD'}, {...rows[2],popularitySource:'javascript:alert(1)'}, ...rows]),{q:'shoe',location:'Taipei, Taiwan',country:'tw',min:105,max:109}).products;
 assert.equal(filtered.length,5);assert.ok(filtered.every(p=>p.price>=105&&p.price<=109));
 assert.throws(()=>parseResearch({status:'incomplete',output:[]},{q:'shoe',location:'Taipei, Taiwan',country:'tw'}));assert.throws(()=>parseResearch({status:'completed',output:[]},{q:'shoe',location:'Taipei, Taiwan',country:'tw'}));
 assert.equal(safeUrl('javascript:alert(1)'),null);
});
test('invalid searches and bounds rejected',()=>{assert.throws(()=>validate({q:' '}));assert.throws(()=>validate({q:'shoe',location:''}));assert.throws(()=>validate({q:'shoe',location:'Taipei, Taiwan',min:2,max:1}));assert.throws(()=>validate({q:'shoe',location:'Taipei, Taiwan',min:'1'}));});
test('GPT request requires web search, source inclusion, JSON schema; cache, CORS, refinement and missing key',async()=>{
 let calls=0,last;const app=createApp({apiKey:'test-only',fetcher:async (url,opts)=>{assert.equal(url,'https://api.openai.com/v1/responses');calls++;last=JSON.parse(opts.body);return {ok:true,json:async()=>response()};}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 const send=(data,origin='https://lisa-shopping.a078bc.chatgpt.site')=>fetch(base+'/api/search',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(data)});
 try{
  assert.equal((await (await fetch(base+'/health')).json()).engine,'gpt-web-search');
  let res=await send({q:'shoe',location:'Taipei, Taiwan',country:'tw'});assert.equal(res.status,200);assert.equal((await res.json()).products.length,10);assert.equal(last.tools[0].type,'web_search');assert.equal(last.tool_choice,'required');assert.ok(last.include.includes('web_search_call.action.sources'));assert.equal(last.text.format.strict,true);assert.equal(last.store,false);assert.equal(JSON.parse(last.input).shoppingLocation,'Taipei, Taiwan');assert.equal(last.tools[0].user_location,undefined);
  await send({q:'shoe',location:'Taipei, Taiwan',country:'tw'});assert.equal(calls,1);
  res=await send({q:'shoe',location:'Taipei, Taiwan',country:'tw',min:109.01});assert.ok((await res.json()).products.every(p=>p.price>109));assert.equal(JSON.parse(last.input).priceRange.min,109.01);
  res=await send({q:'shoe',location:'Taipei, Taiwan',country:'tw',max:104.99});assert.ok((await res.json()).products.every(p=>p.price<105));assert.equal(JSON.parse(last.input).priceRange.max,104.99);
  assert.equal((await send({q:'shoe',location:'Taipei, Taiwan'},'https://untrusted.example')).status,403);assert.equal((await send({q:'shoe',location:'Taipei, Taiwan',min:-1})).status,400);
 }finally{await new Promise(r=>app.close(r));}
 const unconfigured=createApp({apiKey:''});await new Promise(r=>unconfigured.listen(0,'127.0.0.1',r));try{const r=await fetch(`http://127.0.0.1:${unconfigured.address().port}/api/search`,{method:'POST',body:'{"q":"shoe"}'});assert.equal(r.status,503);}finally{await new Promise(r=>unconfigured.close(r));}
});
