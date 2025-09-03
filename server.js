// server.js — 323drop Turbo Image Gen (spirit-only, fast)
// CommonJS. Endpoints: GET /api/trend, GET /api/stats, GET /health
// Env: OPENAI_API_KEY (req), OPENAI_ORG_ID (opt), SPOTIFY_CLIENT_ID/SECRET (opt)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

// ------------------ Config ------------------
const PORT = process.env.PORT || 10000;
const POOL_TARGET = Number(process.env.POOL_TARGET || 10);        // how many pre-made images to keep ready
const POOL_REFILL_LOW = Number(process.env.POOL_REFILL_LOW || 4);  // refill when pool drops below this
const GEN_CONCURRENCY = Number(process.env.GEN_CONCURRENCY || 3);  // parallel image generations
const TREND_TTL_MS = Number(process.env.TREND_TTL_MS || 8*60*1000);
const HISTORY_MAX = Number(process.env.HISTORY_MAX || 500); // never-repeat window size // refresh live trends every 8 min

// ------------------ App & CORS ------------------
const app = express();
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"]; // adjust as needed
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin) ? cb(null, true) : cb(new Error("CORS: origin not allowed"))),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

// ------------------ OpenAI ------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// Build a minimal, spirit-only prompt (fast + generic)
function buildSpiritPrompt(title, artist){
  // New "spirit-only + artist acts it" style — minimal, fast, no typography
  return (
    `Square album‑cover image. Capture only the main spirit of "${title}" performed by ${artist} as a stylized character ` +
    `acting the mood — expressive pose/gesture, movement, and simple scene that conveys the vibe. Focus on silhouette, rhythm, ` +
    `and texture instead of detailed likeness. Clean background. No text, no letters, no logos, no watermark.`
  );
}" by ${artist}. ` +
    `Express mood only via shapes, color, texture, motion cues. No text, no letters, no logos, no watermark.`
  );
}

// Generate via gpt-image-1, then fallback to dall-e-3. Accept url or base64.
async function generateImageUrl(prompt){
  const models = ["gpt-image-1", "dall-e-3"]; // fastest supported
  for(const model of models){
    try{
      const out = await openai.images.generate({ model, prompt, size: "1024x1024" });
      const d = out?.data?.[0];
      const url = d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null);
      if(url) return url;
    }catch(e){
      const msg = e?.response?.data?.error?.message || e?.message || String(e);
      console.error(`[images] ${model} failed:`, msg);
    }
  }
  return null;
}

// ------------------ Live trending (Spotify + Apple) ------------------
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };

function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
function dedupe(items){
  const seen = new Set();
  return items.filter(x=>{
    const k = `${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`;
    if(seen.has(k)) return false; seen.add(k); return true;
  });
}

async function getSpotifyToken(){
  const now = Date.now();
  if(spotifyTokenCache.token && now < spotifyTokenCache.expires - 60000) return spotifyTokenCache.token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if(!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID/SECRET");
  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const resp = await fetch("https://accounts.spotify.com/api/token",{
    method:"POST",
    headers:{
      "Authorization":"Basic "+Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type":"application/x-www-form-urlencoded"
    },
    body
  });
  if(!resp.ok) throw new Error(`Spotify token failed: ${resp.status}`);
  const j = await resp.json();
  spotifyTokenCache = { token: j.access_token, expires: Date.now() + j.expires_in*1000 };
  return spotifyTokenCache.token;
}

async function getSpotifyPlaylistTracks(playlistId, market="US", limit=50){
  const token = await getSpotifyToken();
  const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  url.searchParams.set("market", market);
  url.searchParams.set("limit", String(limit));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if(!r.ok) throw new Error(`Spotify tracks failed: ${r.status}`);
  const j = await r.json();
  return (j.items||[]).map(it=>it.track).filter(Boolean).map(tr=>({
    title: tr.name,
    artist: (tr.artists||[]).map(a=>a.name).join(", "),
    desc: "Charting on Spotify.",
    hashtags: ["#Trending","#Spotify"],
  }));
}

async function getAppleMostPlayed(storefront="us", limit=50){
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`Apple RSS failed: ${r.status}`);
  const j = await r.json();
  return (j.feed?.results||[]).map(x=>({
    title: x.name,
    artist: x.artistName,
    desc: "Most played on Apple Music.",
    hashtags: ["#Trending","#AppleMusic"],
  }));
}

async function loadTrending({market="US", storefront="us"}={}){
  const now = Date.now();
  if(trendingCache.data.length && now < trendingCache.expires) return trendingCache.data;

  const TOP50_GLOBAL = "37i9dQZEVXbMDoHDwVN2tF";
  const VIRAL50_GLOBAL = "37i9dQZEVXbLiRSasKsNU9";

  let items = [];
  try{
    const tasks = [];
    if(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET){
      tasks.push(getSpotifyPlaylistTracks(TOP50_GLOBAL, market, 50));
      tasks.push(getSpotifyPlaylistTracks(VIRAL50_GLOBAL, market, 50));
    }
    tasks.push(getAppleMostPlayed(storefront, 50));
    const parts = await Promise.allSettled(tasks);
    for(const p of parts){ if(p.status === "fulfilled") items.push(...p.value); }
  }catch(e){ console.error("Trending load error:", e?.message || e); }

  if(!items.length){
    items = [
      { title:"Espresso", artist:"Sabrina Carpenter", desc:"Viral chorus hooks.", hashtags:["#Pop","#Earworm"] },
      { title:"Birds of a Feather", artist:"Billie Eilish", desc:"Romance edit magnet.", hashtags:["#AltPop","#Viral"] },
      { title:"Not Like Us", artist:"Kendrick Lamar", desc:"Chant hooks & dance edits.", hashtags:["#HipHop","#TikTokSong"] },
    ];
  }

  const finalList = shuffle(dedupe(items)).slice(0, 120);
  trendingCache = { data: finalList, expires: now + TREND_TTL_MS };
  return finalList;
}

// ------------------ Pre-generation pool ------------------
let pool = []; // items with image ready: { title, artist, description, hashtags, image }
let imageCount = 0;
// never-repeat history (rolling)
let servedSet = new Set();
let servedQueue = [];

// simple semaphore for concurrency
let active = 0; const q = [];
function runWithLimit(fn){
  return new Promise((resolve)=>{
    const task = async ()=>{ try{ active++; resolve(await fn()); } finally { active--; tick(); } };
    q.push(task); tick();
  });
}
function tick(){ while(active < GEN_CONCURRENCY && q.length){ const t = q.shift(); t(); } }

function keyOf(x){ return `${(x.title||'').toLowerCase()}::${(x.artist||'').toLowerCase()}`; }
function markServed(k){
  if(!k) return;
  if(!servedSet.has(k)){
    servedSet.add(k);
    servedQueue.push(k);
    if(servedQueue.length > HISTORY_MAX){
      const old = servedQueue.shift();
      servedSet.delete(old);
    }
  }
}

async function makeOne(candidate){
  const prompt = buildSpiritPrompt(candidate.title, candidate.artist);
  const image = await generateImageUrl(prompt);
    markServed(keyOf(pick));
    if(image){
      imageCount++;
      return res.json({ title: pick.title, artist: pick.artist, description: pick.desc, hashtags: pick.hashtags, image, count: imageCount });
    } else {
      return res.json({ title: pick.title, artist: pick.artist, description: pick.desc, hashtags: pick.hashtags, image: null, count: imageCount });
    }
  }catch(err){
    console.error("/api/trend error:", err?.message || err);
    return res.status(200).json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "We couldn't load images. Text-only.",
      hashtags: ["#music","#trend"],
      image: null,
      count: imageCount,
    });
  }
});

app.listen(PORT, () => console.log(`323drop turbo backend on :${PORT}`));
