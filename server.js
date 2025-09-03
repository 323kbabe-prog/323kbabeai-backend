// server.js — 323drop Turbo (ORIGINAL stylized neon/moody, no text; live charts; pool; never-repeat; retry+recycle)
// CommonJS; Node >= 20. Works on Render.

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici"); // guaranteed fetch

// ------------------ Config ------------------
const PORT = process.env.PORT || 10000;
const POOL_TARGET = Number(process.env.POOL_TARGET || 6);     // ready-made images kept in pool
const POOL_REFILL_LOW = Number(process.env.POOL_REFILL_LOW || 2);
const GEN_CONCURRENCY = Number(process.env.GEN_CONCURRENCY || 1);
const TREND_TTL_MS = Number(process.env.TREND_TTL_MS || 8 * 60 * 1000);
const HISTORY_MAX = Number(process.env.HISTORY_MAX || 500);
const ARCHIVE_MAX = Number(process.env.ARCHIVE_MAX || 32);

// ------------------ App & CORS ------------------
const app = express();
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"]; // adjust if needed
app.use(
  cors({
    origin: (origin, cb) =>
      !origin || ALLOW.includes(origin) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

// ------------------ OpenAI ------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID, // optional
});

// ORIGINAL house style — stylized cover-art, neon/moody, abstract, NO TEXT
function buildSpiritPrompt(title, artist){
  return (
    `Square album-cover image. Aesthetic cover-art visual for "${title}" by ${artist}. ` +
    `Stylized (not photoreal), high-contrast, neon accents, moody lighting, abstract shapes and motion cues. ` +
    `No text, no letters, no logos, no watermark.`
  );
}

// Retry + fallback image generation (fast & robust)
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await openai.images.generate({ model, prompt, size: "1024x1024" });
        const d = out?.data?.[0];
        const url = d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null);
        if (url) return url;
      } catch (e) {
        const status = e?.status || e?.response?.status;
        const msg = e?.response?.data?.error?.message || e?.message || String(e);
        console.error(`[images] ${model} attempt ${attempt + 1} failed:`, status, msg);

        // org gating → next model
        if (status === 403) break;

        // rate limit / transient → short backoff + retry once
        if (status === 429 || /timeout|ECONNRESET|ETIMEDOUT/i.test(msg)) {
          await sleep(300 + Math.random() * 200);
          continue;
        }
      }
      break;
    }
  }
  return null;
}

// ------------------ Live trending (Spotify + Apple) ------------------
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };

function keyOf(x) {
  return `${(x.title || "").toLowerCase()}::${(x.artist || "").toLowerCase()}`;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function dedupe(items) {
  const seen = new Set();
  return items.filter((x) => {
    const k = keyOf(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function getSpotifyToken() {
  const now = Date.now();
  if (spotifyTokenCache.token && now < spotifyTokenCache.expires - 60_000) return spotifyTokenCache.token;
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");

  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!resp.ok) throw new Error(`Spotify token failed: ${resp.status}`);
  const json = await resp.json();
  spotifyTokenCache = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
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
  return (j.items || [])
    .map((it) => it.track)
    .filter(Boolean)
    .map((tr) => ({
      title: tr.name,
      artist: (tr.artists || []).map((a) => a.name).join(", "),
      desc: "Charting on Spotify.",
      hashtags: ["#Trending", "#Spotify"],
    }));
}

async function getAppleMostPlayed(storefront = "us", limit = 50) {
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apple RSS failed: ${r.status}`);
  const j = await r.json();
  return (j.feed?.results || []).map((x) => ({
    title: x.name,
    artist: x.artistName,
    desc: "Most played on Apple Music.",
    hashtags: ["#Trending", "#AppleMusic"],
  }));
}

async function loadTrending({ market = "US", storefront = "us" } = {}) {
  const now = Date.now();
  if (trendingCache.data.length && now < trendingCache.expires) return trendingCache.data;

  const TOP50_GLOBAL = "37i9dQZEVXbMDoHDwVN2tF";
  const VIRAL50_GLOBAL = "37i9dQZEVXbLiRSasKsNU9";

  let items = [];
  try {
    const tasks = [];
    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      tasks.push(getSpotifyPlaylistTracks(TOP50_GLOBAL, market, 50));
      tasks.push(getSpotifyPlaylistTracks(VIRAL50_GLOBAL, market, 50));
    }
    tasks.push(getAppleMostPlayed(storefront, 50));
    const parts = await Promise.allSettled(tasks);
    for (const p of parts) if (p.status === "fulfilled") items.push(...p.value);
  } catch (e) {
    console.error("Trending load error:", e?.message || e);
  }

  if (!items.length) {
    items = [
      { title: "Espresso", artist: "Sabrina Carpenter", desc: "Viral chorus hooks.", hashtags: ["#Pop", "#Earworm"] },
      { title: "Birds of a Feather", artist: "Billie Eilish", desc: "Romance edit magnet.", hashtags: ["#AltPop", "#Viral"] },
      { title: "Not Like Us", artist: "Kendrick Lamar", desc: "Chant hooks & dance edits.", hashtags: ["#HipHop", "#TikTokSong"] },
    ];
  }

  const finalList = shuffle(dedupe(items)).slice(0, 120);
  trendingCache = { data: finalList, expires: now + TREND_TTL_MS };
  return finalList;
}

// ------------------ Pool, never-repeat, archive ------------------
let pool = []; // { title, artist, description, hashtags, image }
let imageCount = 0;

// never-repeat history
let servedSet = new Set();
let servedQueue = []; // FIFO
function markServed(k) {
  if (!k) return;
  if (!servedSet.has(k)) {
    servedSet.add(k);
    servedQueue.push(k);
    if (servedQueue.length > HISTORY_MAX) {
      const old = servedQueue.shift();
      servedSet.delete(old);
    }
  }
}

// recycle archive (if gen fails, still show a visual)
let archive = []; // [{src}]
function stash(imageSrc) {
  if (!imageSrc) return;
  archive.push({ src: imageSrc });
  if (archive.length > ARCHIVE_MAX) archive.shift();
}

// concurrency limiter
let active = 0;
const q = [];
function tick() {
  while (active < GEN_CONCURRENCY && q.length) q.shift()();
}
function runWithLimit(fn) {
  return new Promise((resolve) => {
    const task = async () => {
      try { active++; resolve(await fn()); }
      finally { active--; tick(); }
    };
    q.push(task);
    tick();
  });
}

async function makeOne(candidate) {
  const prompt = buildSpiritPrompt(candidate.title, candidate.artist);
  const image = await generateImageUrl(prompt);
  if (!image) return null;
  stash(image);
  return {
    title: candidate.title,
    artist: candidate.artist,
    description: candidate.desc || "Trending right now.",
    hashtags: candidate.hashtags || ["#Trending", "#NowPlaying"],
    image,
  };
}

async function refillPool() {
  try {
    const trends = await loadTrending();
    const have = new Set(pool.map((x) => keyOf(x)));
    const candidates = trends.filter((t) => {
      const k = keyOf(t);
      return !have.has(k) && !servedSet.has(k);
    });
    const need = Math.max(0, POOL_TARGET - pool.length);
    const picks = candidates.slice(0, need);
    const gens = picks.map((item) => runWithLimit(() => makeOne(item)));
    const done = await Promise.allSettled(gens);
    for (const r of done) {
      if (r.status === "fulfilled" && r.value) {
        pool.push(r.value);
        imageCount++; // count newly generated images
      }
    }
  } catch (e) {
    console.error("refillPool error:", e?.message || e);
  }
}
function ensurePool() {
  if (pool.length < POOL_REFILL_LOW) void refillPool();
}

// boot (non-blocking)
(async () => {
  try { await loadTrending(); await refillPool(); } catch {}
  setInterval(() => { void loadTrending(); ensurePool(); }, 30 * 1000);
})();

// ------------------ API ------------------
app.get("/api/stats", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ count: imageCount });
});

app.get("/api/trend", async (_req, res) => {
  try {
    // serve from pool (avoid repeats)
    if (pool.length) {
      let idx = pool.findIndex((x) => !servedSet.has(keyOf(x)));
      if (idx === -1) { await refillPool(); idx = pool.findIndex((x) => !servedSet.has(keyOf(x))); if (idx === -1) idx = 0; }
      const item = pool.splice(idx, 1)[0];
      markServed(keyOf(item));
      ensurePool();
      return res.json({ ...item, count: imageCount });
    }

    // pool empty: select fresh & try once
    const list = await loadTrending();
    const pick =
      list.find((x) => !servedSet.has(keyOf(x))) ||
      list[0] || { title: "Fresh Drop", artist: "323KbabeAI", desc: "Warming up.", hashtags: ["#music", "#trend"] };

    const prompt = buildSpiritPrompt(pick.title, pick.artist);
    const image = await generateImageUrl(prompt);
    markServed(keyOf(pick));

    if (image) {
      stash(image);
      imageCount++;
      return res.json({ title: pick.title, artist: pick.artist, description: pick.desc, hashtags: pick.hashtags, image, count: imageCount });
    }

    // recycle last good image so UI still shows a visual
    if (archive.length) {
      const recycled = archive[Math.floor(Math.random() * archive.length)].src;
      return res.json({ title: pick.title, artist: pick.artist, description: pick.desc, hashtags: pick.hashtags, image: recycled, count: imageCount });
    }

    // last resort: text-only
    return res.json({ title: pick.title, artist: pick.artist, description: pick.desc, hashtags: pick.hashtags, image: null, count: imageCount });
  } catch (err) {
    console.error("/api/trend error:", err?.message || err);
    return res.status(200).json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "We couldn't load images. Text-only.",
      hashtags: ["#music", "#trend"],
      image: null,
      count: imageCount,
    });
  }
});

app.listen(PORT, () => console.log(`323drop turbo backend on :${PORT}`));
