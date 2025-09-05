// server.js — Info Set v1.2 (KV-mirror safe with /api/trend-kv)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const Vibrant = require("node-vibrant");
const { fetch } = require("undici");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = (process.env.CORS_ALLOW || "https://1ai323.ai,https://www.1ai323.ai")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin)) 
    ? cb(null, true) 
    : cb(new Error("CORS: origin not allowed")),
  methods: ["GET","OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {})
});

/* ---------------- Helpers ---------------- */
async function getSpotifyToken(){
  const id=process.env.SPOTIFY_CLIENT_ID, secret=process.env.SPOTIFY_CLIENT_SECRET;
  if(!id||!secret) throw new Error("Missing Spotify credentials");
  const body=new URLSearchParams({grant_type:"client_credentials"}).toString();
  const r=await fetch("https://accounts.spotify.com/api/token",{
    method:"POST",
    headers:{
      Authorization:"Basic "+Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body
  });
  const j=await r.json(); return j.access_token;
}

async function searchCover({title,artist}){
  try {
    const token=await getSpotifyToken();
    const u=new URL("https://api.spotify.com/v1/search");
    u.searchParams.set("q",`track:${title} artist:${artist}`);
    u.searchParams.set("type","track"); u.searchParams.set("limit","1");
    const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`}}); 
    const j=await r.json(); 
    const t=j?.tracks?.items?.[0]; 
    return t?.album?.images?.[0]?.url || null;
  } catch { return null; }
}

async function extractPaletteHexes(imageUrl,n=6){
  try {
    const res=await fetch(imageUrl); 
    const buf=Buffer.from(await res.arrayBuffer());
    const vib=await Vibrant.from(buf).getPalette();
    return Object.values(vib).filter(Boolean)
      .sort((a,b)=>b.population-a.population)
      .map(sw=>sw.hex).slice(0,n);
  } catch { return []; }
}

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
    "Audio cues:", ...(audioCues||[]).map(c=>"• "+c),
    "No text/logos/watermarks."
  ].filter(Boolean).join(" ");
}

/* ---------------- Image generator ---------------- */
async function generateImageUrl(prompt){
  const out=await openai.images.generate({model:"gpt-image-1",prompt,size:"1024x1024",response_format:"b64_json"});
  const b64=out?.data?.[0]?.b64_json;
  return b64?`data:image/png;base64,${b64}`:null;
}

/* ---------------- KV auto endpoint ---------------- */
app.get("/api/trend-kv", async (req,res)=>{
  res.set({
    "Content-Type":"text/event-stream",
    "Cache-Control":"no-cache, no-transform",
    "Connection":"keep-alive",
    "X-Accel-Buffering":"no"
  });
  const send=(ev,data)=>res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb=setInterval(()=>res.write(":hb\n\n"),15000);

  try {
    // Example trending pick (replace with Spotify/Apple trending logic)
    const title="Tears", artist="Sabrina Carpenter";
    const sex="same"; const heritage="";

    send("status",{msg:"searching cover…"});
    const cover=await searchCover({title,artist}); send("cover",{url:cover});

    send("status",{msg:"extracting palette…"});
    const palette=cover?await extractPaletteHexes(cover,6):[]; send("palette",{hex:palette});

    const audioCues=["soft key lighting","warm optimistic tone"];
    send("audio",{cues:audioCues});

    send("status",{msg:"rendering KV…"});
    const prompt=buildKVPrompt({title,artist,sex,heritage,paletteHexes:palette,audioCues});
    const img=await generateImageUrl(prompt);

    if(img){ send("image",{src:img}); send("end",{ok:true}); }
    else { send("status",{msg:"no image generated"}); send("end",{ok:false}); }
  } catch(e){
    send("status",{msg:String(e?.message||e)});
    send("end",{ok:false});
  } finally {
    clearInterval(hb); res.end();
  }
});

/* ---------------- Health ---------------- */
app.get("/",(req,res)=>res.send("Backend running: Info Set v1.2 KV Mirror ✅"));
app.get("/health",(_req,res)=>res.json({ok:true,time:Date.now()}));

const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log("Info Set v1.2 KV Mirror running on :"+PORT));
