import http from 'node:http';
import { pathToFileURL } from 'node:url';
const countries = new Set(['tw','us','gb','jp','kr','au','ca','in','sg','hk','de','fr']);
export const safeUrl = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
export function validate(input) {
  if (!input || typeof input.q !== 'string' || !input.q.trim() || input.q.trim().length > 200) throw new Error('Enter what you want to buy (up to 200 characters).');
  const out = {q: input.q.trim(), country: countries.has(input.country) ? input.country : 'tw'};
  for (const k of ['min','max']) if (input[k] != null) { if (typeof input[k] !== 'number' || !Number.isFinite(input[k]) || input[k] < 0 || input[k] > 1e12) throw new Error('Invalid price range.'); out[k] = input[k]; }
  if (out.min != null && out.max != null && out.min > out.max) throw new Error('Invalid price range.');
  return out;
}
export function normalize(rows, range) {
  const seen = new Set();
  return rows.flatMap((p, index) => {
    const price = p.extracted_price;
    const url = safeUrl(p.link || p.product_link);
    const id = String(p.product_id || (p.title + '|' + p.source));
    if (!p.title || !url || !Number.isFinite(price) || price < 0 || seen.has(id) || (range.min != null && price < range.min) || (range.max != null && price > range.max)) return [];
    seen.add(id);
    const reviews = Number.isFinite(p.reviews) ? Math.max(0, p.reviews) : 0;
    const rating = Number.isFinite(p.rating) && p.rating >= 0 && p.rating <= 5 ? p.rating : null;
    return [{id,title:String(p.title),price,priceText:String(p.price || price),store:String(p.source || 'View sellers'),url,image:safeUrl(p.thumbnail),rating,reviews,delivery:typeof p.delivery === 'string' ? p.delivery : null,position:index+1,score:reviews}];
  }).sort((a,b)=>b.score-a.score || (b.rating || 0)-(a.rating || 0) || a.position-b.position).slice(0,10).map(({score,...p},i)=>({...p,rank:i+1}));
}
export function createApp({apiKey = process.env.SERPAPI_API_KEY, fetcher = fetch, allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://lisa-shopping.a078bc.chatgpt.site'} = {}) {
  const cache = new Map(), limits = new Map();
  return http.createServer(async (req,res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary','Origin'); res.setHeader('X-Content-Type-Options','nosniff');
    if (origin === allowedOrigin) res.setHeader('Access-Control-Allow-Origin',origin);
    const reply = (code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    if (origin && origin !== allowedOrigin) return reply(403,{error:'This website is not allowed to use this service.'});
    if (req.method === 'OPTIONS') {res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'});return res.end();}
    if (req.url === '/health' && req.method === 'GET') return reply(200,{ok:true,searchReady:Boolean(apiKey)});
    if (req.url !== '/api/search' || req.method !== 'POST') return reply(404,{error:'Not found.'});
    if (!apiKey) return reply(503,{error:'Live shopping search is being prepared. Please try again later.',code:'NOT_CONFIGURED'});
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    for (const [key,v] of limits) if (v.until < now) limits.delete(key);
    const limit = limits.get(ip) || {count:0,until:now+60000};
    if (++limit.count > 30) return reply(429,{error:'Please wait a minute before searching again.'});
    limits.set(ip,limit);
    let raw = '';
    try {
      for await (const chunk of req) {raw += chunk; if (Buffer.byteLength(raw) > 4096) return reply(413,{error:'Search request is too large.'});}
      let input; try {input=validate(JSON.parse(raw));} catch(e) {return reply(400,{error:e instanceof SyntaxError?'Invalid request.':e.message});}
      const key = JSON.stringify(input);
      const cached = cache.get(key); if (cached && cached.until > now) return reply(200,cached.data);
      const url = new URL('https://serpapi.com/search.json');
      url.search = new URLSearchParams({engine:'google_shopping',q:input.q,gl:input.country,hl:input.country === 'tw' || input.country === 'hk' ? 'zh-tw' : input.country==='jp'?'ja':input.country==='kr'?'ko':'en',api_key:apiKey,...(input.min != null?{min_price:String(input.min),sort_by:'1'}:{}),...(input.max != null?{max_price:String(input.max),sort_by:'2'}:{})}).toString();
      const upstream = await fetcher(url,{signal:AbortSignal.timeout(25000)});
      if (!upstream.ok) return reply(502,{error:'Shopping search is temporarily unavailable. Please try again.'});
      const body = await upstream.json();
      if (body.error) return reply(502,{error:'Shopping search is temporarily unavailable. Please try again.'});
      const products = normalize(body.shopping_results || [],input);
      const data = {query:input.q,country:input.country,products,checkedAt:new Date().toISOString(),ranking:'Ranked by review count, then rating, among the shopping results found. This is a popularity signal, not a verified sales ranking.',source:'Google Shopping via SerpApi',range:{min:input.min ?? null,max:input.max ?? null}};
      for (const [k,v] of cache) if (v.until < now) cache.delete(k);
      if(cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key,{data,until:now+600000});
      return reply(200,data);
    } catch {return reply(502,{error:'Shopping search took too long or could not connect. Please try again.'});}
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp(); server.requestTimeout = 30000; server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('LISA Shopping API is listening'));
  process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
}
