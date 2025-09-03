// server.js  — LIVE trends (CommonJS)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

// --- CORS allow your domains (edit if needed) ---
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin) ? cb(null, true) : cb(new Error("CORS: origin not allowed"))),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

// --- OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// --- Simple in-memory state ---
let imageCount = 0;
let lastKey = "";
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };

// --- Small helpers ---
const shuffle = (arr) => { for (let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; };
const dedupeByKey = (items) => {
  const seen = new Set();
  return items.filter(x => {
    const k = `${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
};

// --- Spotify: token + playlist tracks ---
async function getSpotifyToken() {
  const now = Date.now();
  if (spotifyTokenCache.token && now < spotifyTokenCache.expires - 60000) {
    return spotifyTokenCache.token;
  }
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");

  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
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
  const r = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Spotify tracks failed: ${r.status}`);
  const j = await r.json();
  const items = (j.items || [])
    .map(it => it.track)
    .filter(Boolean)
    .map(tr => ({
      title: tr.name,
      artist: (tr.artists || []).map(a => a.name).join(", "),
      desc: "Charting on Spotify playlists.",
      hashtags: ["#Spotify","#Trending"]
    }));
  return items;
}

// --- Apple Music RSS (JSON) ---
async function getAppleMostPlayed(storefront = "us", limit = 50) {
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error(`Apple RSS failed: ${r.status}`);
  const j = await r.json();
  const items = (j.feed?.results || []).map(x => ({
    title: x.name,
    artist: x.artistName,
    desc: "Most played on Apple Music.",
    hashtags: ["#AppleMusic","#MostPlayed"]
  }));
  return items;
}

// --- Build fresh trending list (cached ~8min) ---
async function loadTrending({ market = "US", storefront = "us" } = {}) {
  const now = Date.now();
  if (trendingCache.data.length && now < trendingCache.expires) {
    return trendingCache.data;
  }

  // Spotify official playlist IDs (Global):
  const SPOTIFY_TOP50_GLOBAL = "37i9dQZEVXbMDoHDwVN2tF";     // Top 50 - Global
  const SPOTIFY_VIRAL50_GLOBAL = "37i9dQZEVXbLiRSasKsNU9";   // Viral 50 - Global

  let items = [];
  try {
    const [top50, viral50, apple] = await Promise.all([
      getSpotifyPlaylistTracks(SPOTIFY_TOP50_GLOBAL, market, 50),
      getSpotifyPlaylistTracks(SPOTIFY_VIRAL50_GLOBAL, market, 50),
      getAppleMostPlayed(storefront, 50),
    ]);
    items = [...top50, ...viral50, ...apple];
  } catch (e) {
    console.error("Trending sources error:", e?.message || e);
  }

  if (!items.length) {
    // safety fallback pool
    items = [
      { title: "Espresso", artist: "Sabrina Carpenter", desc: "Ultra-clippy pre-chorus; edit bait all over FYP.", hashtags: ["#Pop","#Earworm"] },
      { title: "Birds of a Feather", artist: "Billie Eilish", desc: "Whisper-pop chorus synced to romance edits.", hashtags: ["#AltPop","#ViralClip"] },
      { title: "Not Like Us", artist: "Kendrick Lamar", desc: "Beat switch + chant hooks fueling dance cuts.", hashtags: ["#HipHop","#TikTokSong"] },
    ];
  }

  const finalList = shuffle(dedupeByKey(items)).slice(0, 120);
  trendingCache = { data: finalList, expires: now + (8 * 60 * 1000) }; // 8 minutes
  return finalList;
}

// --- Image generation (URL or base64; with model fallback) ---
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await openai.images.generate({ model, prompt, size: "1024x1024" });
      const d = out?.data?.[0];
      const url = d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null);
      if (url) return url;
    } catch (e) {
      const msg = e?.response?.data?.error?.message || e?.message || String(e);
      console.error(`[images] ${model} failed:`, msg);
    }
  }
  return null;
}

// --- Routes ---
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

app.get("/api/stats", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ count: imageCount });
});

app.get("/api/trend", async (req, res) => {
  const market = (req.query.market || "US").toUpperCase();    // for Spotify
  const storefront = (req.query.storefront || "us").toLowerCase(); // for Apple

  try {
    const list = await loadTrending({ market, storefront });
    if (!list.length) throw new Error("No trends available");

    // rotate & avoid immediate repeat
    let pick = list[Math.floor(Math.random() * list.length)];
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = `${pick.title}::${pick.artist}`.toLowerCase();

    const prompt = `Aesthetic cover-art visual for "${pick.title}" by ${pick.artist}. Neon, moody, cinematic lighting, NO text overlay.`;
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;

    return res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc || "Trending right now.",
      hashtags: pick.hashtags || ["#Trending","#NowPlaying"],
      image: imageUrl,   // may be https://… or data:image/png;base64,…
      count: imageCount,
    });
  } catch (err) {
    console.error("trend route error:", err?.message || err);
    return res.status(200).json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "We couldn’t pull live charts. Showing text-only.",
      hashtags: ["#music","#trend"],
      image: null,
      count: imageCount,
      error: "Live charts unavailable",
    });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323drop live backend on :${PORT}`));
