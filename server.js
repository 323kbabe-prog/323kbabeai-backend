// server.js — 323drop Live (Gen-Z fans styles + title/Spotify vibe + SSE + fallbacks + inspo notes)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

const app = express();

/* ---------------- CORS ---------------- */
// Safe mode: allow all origins (no crash on Render health checks)
app.use(cors({
  origin: (origin, cb) => cb(null, true),
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

// --- Newest-first state ---
let trendIndex = 0;
let trendList = [];

/* ---------------- Helpers ---------------- */
const dedupeByKey = (items) => {
  const seen = new Set();
  return items.filter(x => {
    const k = `${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
};

/* ---------------- Description ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal.`,
    `When “${title}” comes on, I can’t help but stop scrolling and let it run.`,
    `I’ve had “${title}” by ${artist} stuck in my head all day — addictive in the best way.`,
    `Listening to “${title}” makes me feel like I’m in on the trend before it blows up.`,
    `Every time I hear “${title}” by ${artist}, I get that rush that only a viral track can bring.`
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------------- Spotify & Apple trending ---------------- */
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
  } catch (e) { console.error("Trending sources error:", e?.message || e); }

  if (!items.length) {
    items = [
      { title: "Espresso", artist: "Sabrina Carpenter", desc: "Viral chorus hooks.", hashtags: ["#Pop","#Earworm"] },
      { title: "Birds of a Feather", artist: "Billie Eilish", desc: "Romance edit magnet.", hashtags: ["#AltPop","#Viral"] },
      { title: "Not Like Us", artist: "Kendrick Lamar", desc: "Chant hooks & dance edits.", hashtags: ["#HipHop","#TikTokSong"] },
    ];
  }

  // ✅ FIX: keep natural order (newest/top → oldest), no shuffle
  trendingCache = { data: dedupeByKey(items).slice(0, 120), expires: now + 8*60*1000 };
  return trendingCache.data;
}

/* ---------------- Sequential picker ---------------- */
async function nextNewestPick({ market = "US", storefront = "us" } = {}) {
  const list = await loadTrending({ market, storefront });
  if (!trendList.length) {
    trendList = dedupeByKey([...list]); // keep chart order
    trendIndex = 0;
  }
  if (trendIndex >= trendList.length) {
    trendList = dedupeByKey([...list]);
    trendIndex = 0;
  }
  const pick = trendList[trendIndex];
  trendIndex++;
  return pick;
}

/* ---------------- Image generation + fallback ---------------- */
function neonSvgPlaceholder(seed) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
    <rect width='1024' height='1024' fill='black'/>
    <text x='50%' y='50%' fill='white' font-size='40' text-anchor='middle' dominant-baseline='middle'>323drop</text>
  </svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

async function getImageWithFallback(pick) {
  try {
    const out = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `Cover image for "${pick.title}" by ${pick.artist}`,
      size: "1024x1024"
    });
    return out?.data?.[0]?.url || neonSvgPlaceholder(`${pick.title}|${pick.artist}`);
  } catch (e) {
    lastImgErr = { status: e?.status || null, message: e?.message || String(e) };
    console.error("Image error:", lastImgErr);
    return neonSvgPlaceholder(`${pick.title}|${pick.artist}`);
  }
}

/* ---------------- Diagnostics ---------------- */
app.get("/diag/images", (_req, res) => res.json({ lastImgErr }));
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- SSE stream ---------------- */
app.get("/api/trend-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15015);

  send("hello", { ok: true });

  try {
    const market = String(req.query.market || "US").toUpperCase();
    const pick = await nextNewestPick({ market });
    const imageUrl = await getImageWithFallback(pick);

    send("trend", {
      title: pick.title,
      artist: pick.artist,
      description: (pick.desc || "Trending right now.") + " " + makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: pick.hashtags || ["#Trending","#NowPlaying"],
      image: imageUrl
    });

    send("count", { count: ++imageCount });
    send("end", { ok:true });
  } catch (e) {
    send("status", { msg: `error: ${e?.message || e}` });
    send("end", { ok:false });
  }
});

/* ---------------- JSON one-shot ---------------- */
app.get("/api/trend", async (req, res) => {
  try {
    const market = String(req.query.market || "US").toUpperCase();
    const pick = await nextNewestPick({ market });
    const imageUrl = await getImageWithFallback(pick);

    res.json({
      title: pick.title,
      artist: pick.artist,
      description: (pick.desc || "Trending right now.") + " " + makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: pick.hashtags || ["#Trending","#NowPlaying"],
      image: imageUrl,
      count: ++imageCount
    });
  } catch (e) {
    res.json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "Text-only.",
      hashtags: ["#music","#trend"],
      image: neonSvgPlaceholder("fallback"),
      count: imageCount
    });
  }
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
});
