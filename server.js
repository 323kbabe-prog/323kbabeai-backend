// server.js — Info Set v1.2 KV Mirror (safe, with lyrics-finder + Genius fallback)

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import Vibrant from "node-vibrant";
import { fetch } from "undici";
import lyricsFinder from "lyrics-finder";
import Genius from "genius-lyrics";

const app = express();
const geniusClient = process.env.GENIUS_API_KEY ? new Genius.Client(process.env.GENIUS_API_KEY) : null;

/* ---------------- CORS ---------------- */
let ALLOW = [];
if (process.env.CORS_ALLOW) {
  ALLOW = process.env.CORS_ALLOW.split(",").map(s => s.trim()).filter(Boolean);
}

app.use(cors({
  origin: (origin, cb) => {
    if (!process.env.CORS_ALLOW) return cb(null, true); // allow all if unset
    if (!origin || ALLOW.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET","OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {})
});

/* ---------------- State ---------------- */
let trendingCache = { data: [], expires: 0 };
let lastPick = "";

/* ---------------- Helpers ---------------- */
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
function dedupe(items){ const seen=new Set(); return items.filter(x=>{ const key=`${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`; if(seen.has(key)) return false; seen.add(key); return true; }); }

async function getSpotifyToken(){
  const id=process.env.SPOTIFY_CLIENT_ID, secret=process.env.SPOTIFY_CLIENT_SECRET;
  if(!id||!secret) throw new Error("Missing Spotify credentials");
  const body=new URLSearchParams({grant_type:"client_credentials"}).toString();
  const r=await fetch("https://accounts.spotify.com/api/token",{
    method:"POST",
    headers:{ Authorization:"Basic "+Buffer.from(`${id}:${secret}`).toString("base64"),
              "Content-Type":"application/x-www-form-urlencoded" },
    body
  });
  const j=await r.json(); return j.access_token;
}

async function getSpotifyPlaylistTracks(playlistId, market="US", limit=50){
  const token=await getSpotifyToken();
  const url=new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  url.searchParams.set("market",market); url.searchParams.set("limit",String(limit));
  const r=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.ok) throw new Error(`Spotify ${r.status}`);
  const j=await r.json();
  return (j.items||[]).map(it=>it.track).filter(Boolean).map(tr=>({
    title:tr.name,
    artist:(tr.artists||[]).map(a=>a.name).join(", "),
  }));
}

async function getAppleMostPlayed(storefront="us",limit=50){
  const url=`https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const r=await fetch(url); if(!r.ok) return [];
  const j=await r.json();
  return (j.feed?.results||[]).map(x=>({title:x.name,artist:x.artistName}));
}

/* ---------------- Lyrics Search ---------------- */
async function searchLyrics({title,artist}){
  try {
    const cleanTitle = title.replace(/\(.*?\)|\[.*?\]|-.*$/g, "").trim();
    let lyrics = await lyricsFinder(artist, cleanTitle);

    if (!lyrics && geniusClient) {
      const results = await geniusClient.songs.search(`${cleanTitle} ${artist}`);
      if (results.length > 0) {
        lyrics = await results[0].lyrics();
      }
    }

    return lyrics || "Lyrics not available.";
  } catch(e) {
    console.error("lyrics error:", e.message);
    return "Lyrics not available.";
  }
}

/* ---------------- Cover Search ---------------- */
async function searchCover({title,artist}){
  let cover=null;
  try{
    const token=await getSpotifyToken();
    const u=new URL("https://api.spotify.com/v1/search");
    u.searchParams.set("q",`track:${title} artist:${artist}`);
    u.searchParams.set("type","track"); u.searchParams.set("limit","1");
    const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`}});
    const j=await r.json(); cover=j?.tracks?.items?.[0]?.album?.images?.[0]?.url||null;
  }catch{}

  if(!cover){
    try{
      const it=new URL("https://itunes.apple.com/search");
      it.searchParams.set("term",`${title} ${artist}`);
      it.searchParams.set("entity","song"); it.searchParams.set("limit","1");
      const rr=await fetch(it); const jj=await rr.json();
      const a=jj.results?.[0]?.artworkUrl100;
      cover=a? a.replace("100x100bb","1000x1000bb"):null;
    }catch{}
  }

  if(!cover){
    try{
      const search=await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(title)}+artist:${encodeURIComponent(artist)}&fmt=json`);
      const mb=await search.json();
      const release=mb.recordings?.[0]?.releases?.[0]?.id;
      if(release) cover=`https://coverartarchive.org/release/${release}/front-500.jpg`;
    }catch{}
  }

  if(!cover){
    cover="data:image/svg+xml;base64,"+Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="#ff66cc" offset="0%"/>
          <stop stop-color="#00ccff" offset="100%"/>
        </linearGradient></defs>
        <rect width="1024" height="1024" fill="url(#g)"/>
      </svg>
    `).toString("base64");
  }
  return cover;
}

/* ---------------- Palette + Prompt Helpers ---------------- */
async function extractPaletteHexes(imageUrl,n=6){
  try{ const res=await fetch(imageUrl); const buf=Buffer.from(await res.arrayBuffer());
       const vib=await Vibrant.from(buf).getPalette();
       return Object.values(vib).filter(Boolean).sort((a,b)=>b.population-a.population).map(sw=>sw.hex).slice(0,n);
  }catch{return [];}
}

function kvPoseSafe(){ return [
  "low-angle fashion pose on beige carpet against white curtain",
  "subject kneeling in black dress; hair flip gesture; retro on-camera flash look; subtle film grain"
];}

function buildKVPrompt({title,artist,paletteHexes}){
  return [
    `Create a photo-real editorial Key Visual for the song "${title}" by ${artist}.`,
    "Original face (no look-alike). 1:1 frame.",
    "KV-mirror cues (safe):",
    ...kvPoseSafe().map(t=>"• "+t),
    (paletteHexes?.length?`Palette from real cover: ${paletteHexes.join(", ")}`:""),
    "No text/logos/watermarks."
  ].filter(Boolean).join(" ");
}

/* ---------------- Image Generator ---------------- */
async function generateImageUrl(prompt){
  try{
    const out=await openai.images.generate({
      model:"gpt-image-1",
      prompt,
      size:"1024x1024"
    });
    return out.data[0].url||null;
  }catch(e){
    console.error("[images]",e.message||e);
    return null;
  }
}

/* ---------------- Trending Loader ---------------- */
async function loadTrending({ market="US", storefront="us" } = {}){
  const now=Date.now();
  if(trendingCache.data.length && now<trendingCache.expires) return trendingCache.data;

  const TOP50="37i9dQZEVXbMDoHDwVN2tF";
  const VIRAL50="37i9dQZEVXbLiRSasKsNU9";
  let items=[];
  try {
    const [top50, viral50, apple]=await Promise.all([
      getSpotifyPlaylistTracks(TOP50, market, 50),
      getSpotifyPlaylistTracks(VIRAL50, market, 50),
      getAppleMostPlayed(storefront,50)
    ]);
    items=[...top50,...viral50,...apple];
  } catch(e){ console.error("Trending error:",e.message); }

  if(!items.length){
    items=[
      {title:"Espresso",artist:"Sabrina Carpenter"},
      {title:"Birds of a Feather",artist:"Billie Eilish"},
      {title:"Not Like Us",artist:"Kendrick Lamar"}
    ];
  }

  trendingCache={ data: shuffle(dedupe(items)), expires: now+8*60*1000 };
  return trendingCache.data;
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
    const list=await loadTrending();
    if(!list.length) throw new Error("No trending tracks");

    let pick=list[Math.floor(Math.random()*list.length)];
    if(`${pick.title}::${pick.artist}`===lastPick && list.length>1){
      pick=list.find(x=>`${x.title}::${x.artist}`!==lastPick)||pick;
    }
    lastPick=`${pick.title}::${pick.artist}`;

    send("status",{msg:`Selected: ${pick.title} by ${pick.artist}`});

    const cover=await searchCover(pick); send("cover",{url:cover});
    const palette=cover?await extractPaletteHexes(cover,6):[];

    const lyrics=await searchLyrics(pick);
    send("lyrics",{text:lyrics});

    const prompt=buildKVPrompt({title:pick.title,artist:pick.artist,paletteHexes:palette});
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
