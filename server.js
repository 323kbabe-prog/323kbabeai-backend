// server.js — 323drop Live (SSE status + fallbacks)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

/* ---------------- State ---------------- */
let imageCount = 0;
let lastKey = "";
let lastImgErr = null;
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };

/* ---------------- Helpers ---------------- */
const shuffle = (a) => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const dedupeByKey = (items) => {
  const seen = new Set();
  return items.filter(x => {
    const k = `${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
};

/* ---------------- Live trend sources (optional) ---------------- */
async function getSpotifyToken() {
  const now = Date.now();
  if (spotifyTokenCache.token && now < spotifyTokenCache.expires - 60000) return spotifyTokenCache.token;
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");
  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`Spotify token failed: ${resp.status}`);
  const json = await resp.json();
  spotifyTokenCache = { token: json.access_token, expires: Date.now() + (json.expires_in * 1000) };
  return spotifyTokenCache.token;
}
async function getSpotifyPlaylistTracks(playlistId, market = "US", limit = 50) {
  const token = await getSpotifyToken();
  const url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  url.searchParams.set("market", market);
  url.searchParams.set("limit", String(limit));
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Spotify tracks failed: ${r.status}`);
  const j = await r.json();
  return (j.items || []).map(it => it.track).filter(Boolean).map(tr => ({
    title: tr.name,
    artist: (tr.artists || []).map(a => a.name).join(", "),
    desc: "Charting on Spotify.",
    hashtags: ["#Trending","#Spotify"],
  }));
}
async function getAppleMostPlayed(storefront = "us", limit = 50) {
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apple RSS failed: ${r.status}`);
  const j = await r.json();
  return (j.feed?.results || []).map(x => ({
    title: x.name,
    artist: x.artistName,
    desc: "Most played on Apple Music.",
    hashtags: ["#Trending","#AppleMusic"],
  }));
}
async function loadTrending({ market = "US", storefront = "us" } = {}) {
  const now = Date.now();
  if (trendingCache.data.length && now < trendingCache.expires) return trendingCache.data;
  const TOP50_GLOBAL = "37i9dQZEVXbMDoHDwVN2tF";
  const VIRAL50_GLOBAL = "37i9dQZEVXbLiRSasKsNU9";
  let items = [];
  try {
    const [top50, viral50, apple] = await Promise.all([
      getSpotifyPlaylistTracks(TOP50_GLOBAL, market, 50),
      getSpotifyPlaylistTracks(VIRAL50_GLOBAL, market, 50),
      getAppleMostPlayed(storefront, 50),
    ]);
    items = [...top50, ...viral50, ...apple];
  } catch (e) {
    console.error("Trending sources error:", e?.message || e);
  }

  if (!items.length) {
    items = [
      { title: "Espresso",           artist: "Sabrina Carpenter", desc: "Viral chorus hooks.",        hashtags: ["#Pop","#Earworm"] },
      { title: "Birds of a Feather", artist: "Billie Eilish",     desc: "Romance edit magnet.",       hashtags: ["#AltPop","#Viral"] },
      { title: "Not Like Us",        artist: "Kendrick Lamar",    desc: "Chant hooks & dance edits.", hashtags: ["#HipHop","#TikTokSong"] },
    ];
  }
  trendingCache = { data: shuffle(dedupeByKey(items)).slice(0, 120), expires: now + 8*60*1000 };
  return trendingCache.data;
}

/* ---------------- Image generation + fallbacks ---------------- */
function stylizedPrompt(title, artist) {
  return (
    `Square album-cover image for "${title}" by ${artist}. ` +
    `Stylized (not photoreal), high-contrast monochrome mood, abstract shapes and motion cues. ` +
    `Create an original face inspired by the artist’s vibe (do NOT exactly replicate a real person). ` +
    `No text, no letters, no logos, no watermark.`
  );
}

async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await openai.images.generate({
          model,
          prompt,
          size: "1024x1024",
          response_format: "b64_json", // prefer b64 for CORS safety
        });
        const d = out?.data?.[0];
        const b64 = d?.b64_json;
        const url = d?.url;
        if (b64) return `data:image/png;base64,${b64}`;
        if (url)  return url;
      } catch (e) {
        lastImgErr = {
          model,
          attempt: attempt + 1,
          status: e?.status || e?.response?.status || null,
          message: e?.response?.data?.error?.message || e?.message || String(e),
        };
        console.error("[images]", lastImgErr);
        if (lastImgErr.status === 403) break; // not allowed in org → next model
        if (lastImgErr.status === 429 || /timeout|ECONNRESET|ETIMEDOUT/i.test(lastImgErr.message)) {
          await sleep(300 + Math.random()*300);
          continue;
        }
      }
      break;
    }
  }
  return null;
}

// Public iTunes artwork fallback (preview use)
async function fallbackArtwork({ title, artist }) {
  try {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", `${title} ${artist}`);
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "1");
    const r = await fetch(url);
    if (!r.ok) throw new Error(`itunes ${r.status}`);
    const j = await r.json();
    const a = j.results?.[0]?.artworkUrl100 || j.results?.[0]?.artworkUrl60;
    if (!a) return null;
    return a
      .replace(/60x60bb(\.(jpg|png))/, "1000x1000bb$1")
      .replace(/100x100bb(\.(jpg|png))/, "1000x1000bb$1");
  } catch {
    return null;
  }
}

// Guaranteed B/W abstract placeholder (no text)
function bwSvgPlaceholder(seed) {
  const n = Array.from(seed).reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0)>>>0;
  const r1 = 180 + (n % 180), r2 = 110 + (n % 110);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='#000'/><stop offset='100%' stop-color='#fff'/>
      </linearGradient>
      <filter id='grain'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncA type='table' tableValues='0 .06'/></feComponentTransfer></filter>
    </defs>
    <rect width='1024' height='1024' fill='url(#g)'/>
    <rect width='1024' height='1024' filter='url(#grain)' opacity='.2'/>
    <circle cx='512' cy='512' r='${r1}' fill='none' stroke='#fff' stroke-opacity='.12' stroke-width='2'/>
    <circle cx='512' cy='512' r='${r2}' fill='none' stroke='#fff' stroke-opacity='.08' stroke-width='2'/>
  </svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

async function getImageWithFallback(pick, prompt) {
  // 1) Try OpenAI
  const img = await generateImageUrl(prompt);
  if (img) return img;
  // 2) Try album artwork (public iTunes Search API)
  const art = await fallbackArtwork(pick);
  if (art) return art;
  // 3) Guaranteed abstract B/W
  return bwSvgPlaceholder(`${pick.title}|${pick.artist}`);
}

/* ---------------- Diagnostics ---------------- */
app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/diag/env", (_req,res) => {
  res.json({
    has_OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    has_OPENAI_ORG_ID:  Boolean(process.env.OPENAI_ORG_ID),
    has_SPOTIFY_ID:     Boolean(process.env.SPOTIFY_CLIENT_ID),
    has_SPOTIFY_SECRET: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
    node: process.version,
  });
});
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get("/api/stats", (_req, res) => res.set("Cache-Control","no-store").json({ count: imageCount }));

/* ---------------- SSE stream ---------------- */
app.get("/api/trend-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15000);

  send("hello", { ok: true });

  let pick;
  try {
    send("status", { msg: "fetching live trends…" });
    const list = await loadTrending({ market: "US", storefront: "us" });
    pick = list[Math.floor(Math.random() * list.length)];
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;
  } catch (e) {
    clearInterval(hb);
    send("status", { msg: "failed to load trends." });
    send("end", { ok:false });
    return res.end();
  }

  send("trend", {
    title: pick.title,
    artist: pick.artist,
    description: pick.desc || "Trending right now.",
    hashtags: pick.hashtags || ["#Trending","#NowPlaying"]
  });

  try {
    send("status", { msg: "generating image…" });
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await getImageWithFallback(pick, prompt);

    if (lastImgErr) send("diag", lastImgErr); // surface if we fell back

    if (imageUrl) {
      imageCount += 1;
      send("count", { count: imageCount });
      send("image", { src: imageUrl });
      send("status", { msg: "done" });
      send("end", { ok:true });
    } else {
      send("status", { msg: "image unavailable." });
      send("end", { ok:false });
    }
  } catch (e) {
    send("status", { msg: `error: ${e?.message || e}` });
    send("end", { ok:false });
  } finally {
    clearInterval(hb);
    res.end();
  }
});

/* ---------------- Legacy JSON endpoint ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const list = await loadTrending({ market: "US", storefront: "us" });
    let pick = list[Math.floor(Math.random() * list.length)];
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;

    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await getImageWithFallback(pick, prompt);
    if (imageUrl) imageCount += 1;

    res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc || "Trending right now.",
      hashtags: pick.hashtags || ["#Trending","#NowPlaying"],
      image: imageUrl,
      count: imageCount
    });
  } catch (e) {
    res.json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "Text-only.",
      hashtags: ["#music","#trend"],
      image: null,
      count: imageCount
    });
  }
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
  console.log("OpenAI key present:", !!process.env.OPENAI_API_KEY, "| Org set:", !!process.env.OPENAI_ORG_ID);
});

