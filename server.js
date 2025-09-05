// server.js — Info Set v1.2 (KV-mirror safe)
// Adds title/artist support in KV mode to mirror the real cover palette + audio vibe safely.
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const Vibrant = require("node-vibrant");
const { fetch } = require("undici");

const app = express();

/* CORS */
const ALLOW = (process.env.CORS_ALLOW || "https://1ai323.ai,https://www.1ai323.ai")
  .split(",").map(s=>s.trim()).filter(Boolean);
app.use(cors({
  origin: (o,cb)=>(!o||ALLOW.includes(o))?cb(null,true):cb(new Error("CORS: origin not allowed")),
  methods:["GET","OPTIONS"], allowedHeaders:["Content-Type"], maxAge:86400
}));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID?{organization:process.env.OPENAI_ORG_ID}:{})
});

/* Spotify + iTunes helpers */
async function getSpotifyToken(){
  const id=process.env.SPOTIFY_CLIENT_ID, secret=process.env.SPOTIFY_CLIENT_SECRET;
  if(!id||!secret) throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");
  const r=await fetch("https://accounts.spotify.com/api/token",{
    method:"POST",
    headers:{
      Authorization:"Basic "+Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body:new URLSearchParams({grant_type:"client_credentials"}).toString()
  });
  const j=await r.json(); return j.access_token;
}
async function searchCover({title,artist}){
  try{
    const token=await getSpotifyToken();
    const u=new URL("https://api.spotify.com/v1/search");
    u.searchParams.set("q",`track:${title} artist:${artist}`);
    u.searchParams.set("type","track"); u.searchParams.set("limit","1");
    const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`}}); const j=await r.json();
    const t=j?.tracks?.items?.[0]; const img=t?.album?.images?.[0]?.url;
    if(img) return img;
  }catch{}
  try{
    const it=new URL("https://itunes.apple.com/search");
    it.searchParams.set("term",`${title} ${artist}`);
    it.searchParams.set("entity","song"); it.searchParams.set("limit","1");
    const r=await fetch(it); const j=await r.json();
    const a=j.results?.[0]?.artworkUrl100 || j.results?.[0]?.artworkUrl60;
    if(!a) return null;
    return a.replace(/60x60bb(\.(jpg|png))/,"1000x1000bb$1").replace(/100x100bb(\.(jpg|png))/,"1000x1000bb$1");
  }catch{return null;}
}
async function extractPaletteHexes(imageUrl,n=6){
  try{
    const res=await fetch(imageUrl); const buf=Buffer.from(await res.arrayBuffer());
    const vib=await Vibrant.from(buf).getPalette();
    return Object.values(vib).filter(Boolean)
      .sort((a,b)=>b.population-a.population)
      .map(sw=>sw.hex).slice(0,n);
  }catch{return [];}
}
async function audioFeatures(title,artist){
  try{
    const token=await getSpotifyToken();
    const u=new URL("https://api.spotify.com/v1/search");
    u.searchParams.set("q",`track:${title} artist:${artist}`);
    u.searchParams.set("type","track"); u.searchParams.set("limit","1");
    const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`}}); const j=await r.json();
    const tr=j?.tracks?.items?.[0]; if(!tr) return null;
    const fr=await fetch(`https://api.spotify.com/v1/audio-features/${tr.id}`,{headers:{Authorization:`Bearer ${token}`}}); 
    return await fr.json();
  }catch{return null;}
}
function vibeCues(f){
  if(!f) return ["balanced neutral lighting"];
  const cues=[];
  cues.push(f.energy>=.7?"higher contrast; crisp rim":"soft key; gentle roll-off");
  cues.push(f.valence>=.6?"warmer optimistic tone":"cool contemplative tone");
  if(f.danceability>=.7) cues.push("subtle motion/flow in hair or wardrobe");
  if(f.tempo>140) cues.push("punchier pose / micro-gesture");
  return cues;
}

/* KV-mirror safe pose */
function kvPoseSafe(){ return [
  "low-angle fashion pose on beige carpet against white curtain",
  "subject kneeling in black dress; hair flip gesture; retro on-camera flash look; subtle film grain"
];}
function buildKVPrompt({title,artist,sex,heritage,paletteHexes,audioCues}){
  return [
    `Create a photo-real editorial Key Visual for the song "${title}" by ${artist}.`,
    "Original face (no look-alike). 1:1 frame.",
    ...(sex? [`present the subject as ${sex} in appearance and styling; respectful and natural`] : []),
    ...(heritage? [`depict the subject with ${heritage} heritage authentically; avoid stereotypes`] : []),
    "KV-mirror cues (safe):",
    ...kvPoseSafe().map(t=>"• "+t),
    (paletteHexes?.length? `Palette from real cover: ${paletteHexes.join(", ")}`:""),
    "Audio cues:", ...audioCues.map(c=>"• "+c),
    "No text/logos/watermarks."
  ].filter(Boolean).join(" ");
}

/* SSE endpoint */
app.get("/api/kv-stream", async (req,res)=>{
  res.set({"Content-Type":"text/event-stream","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
  const send=(ev,data)=>res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb=setInterval(()=>res.write(":hb\n\n"),15000);
  try{
    const title=String(req.query.title||"").trim();
    const artist=String(req.query.artist||"").trim();
    if(!title||!artist){ send("status",{msg:"title & artist required"}); send("end",{ok:false}); clearInterval(hb); return res.end(); }
    const sex=String(req.query.sex||"same");
    const heritage=String(req.query.heritage||req.query.race||"");
    send("status",{msg:"searching cover…"}); const cover=await searchCover({title,artist}); send("cover",{url:cover});
    send("status",{msg:"extracting palette…"}); const palette=cover? await extractPaletteHexes(cover,6):[]; send("palette",{hex:palette});
    send("status",{msg:"reading audio vibe…"}); const af=await audioFeatures(title,artist); const cues=vibeCues(af); send("audio",{cues});
    const prompt=buildKVPrompt({title,artist,sex,heritage,paletteHexes:palette,audioCues:cues});
    send("status",{msg:"rendering KV…"});
    const out=await openai.images.generate({model:"gpt-image-1",prompt,size:"1024x1024",response_format:"b64_json"});
    const b64=out?.data?.[0]?.b64_json;
    send("image",{src: b64?`data:image/png;base64,${b64}`:null});
    send("end",{ok:!!b64});
  }catch(e){ send("status",{msg:String(e?.message||e)}); send("end",{ok:false}); }
  finally{ clearInterval(hb); res.end(); }
});

/* Health */
app.get("/health",(_req,res)=>res.json({ok:true}));

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log("Info Set v1.2 KV-mirror running on :"+PORT));
