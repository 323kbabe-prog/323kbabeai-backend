// server.js — 323drop LIVE backend (CommonJS)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// Optional fetch polyfill for Node <18
// if (typeof fetch === "undefined") {
//   global.fetch = (...a) => import("node-fetch").then(({ default: f }) => f(...a));
// }

const app = express();

// ---------- Security & CORS ----------
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(
  cors({
    origin: (origin, cb) =>
      !origin || ALLOW.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS: origin not allowed")),
    methods: ["GET", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

// Basic rate limit to protect costs
const trendLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/trend", trendLimiter);

// ---------- OpenAI client ----------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID,
});

// ---------- Helpers ----------
const withTimeout = (p, ms = 8000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`Timeout ${ms}ms`)), ms)),
  ]);

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const dedupeByKey = (items) => {
  const seen = new Set();
  return items.filter((x) => {
    const k = `${(x.title || "").toLowerCase()}::${(x.artist || "").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// ---------- In-memory state ----------
let imageCount = 0;
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };
const lastKeys = [];
function pushKey(k, n = 3) {
  lastKeys.push(k);
  while (lastKeys.length > n) lastKeys.shift();
}
function isRecent(k) {
  return lastKeys.includes(k);
}

// ---------- Spotify ----------
async function getSpotifyToken() {
  const now = Date.now();
  if (spotifyTokenCache.token && now < spotifyTokenCache.expires - 60_000) {
    return spotifyTokenCache.token;
  }
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");

  const body = new URLSearchParams({ grant_type: "client_credentials" }).toString();
  const resp = await withTimeout(
    fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }),
    8000
  );
  if (!resp.ok) throw new Error(`Spotify token failed: ${resp.status}`);
  const json = await resp.json();
  spotifyTokenCache = {
    token: json.access_token,
    expires: Date.now() + json.expires_in * 1000,
  };
  return spotifyTokenCache.token;
}

async function getSpotifyPlaylistTracks(playlistId, market = "US", pageLimit = 100) {
  const token = await getSpotifyToken();
  let url = new URL(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`);
  url.searchParams.set("market", market);
  url.searchParams.set("limit", "100");
  const out = [];
  while (url && out.length < pageLimit) {
    const r = await withTimeout(fetch(url, { headers: { Authorization: `Bearer ${token}` } }), 8000);
    if (!r.ok) throw new Error(`Spotify tracks failed: ${r.status}`);
    const j = await r.json();
    for (const it of j.items || []) {
      const tr = it.track;
      if (!tr) continue;
      out.push({
        title: tr.name,
        artist: (tr.artists || []).map((a) => a.name).join(", "),
        desc: "Charting on Spotify playlists.",
        hashtags: ["#Spotify", "#Trending"],
      });
    }
    url = j.next ? new URL(j.next) : null;
  }
  return out;
}

// ---------- Apple Music ----------
async function getAppleMostPlayed(storefront = "us", limit = 50) {
  const url = `https://rss.applemarketingtools.com/api/v2/${storefront}/music/most-played/${limit}/songs.json`;
  const r = await withTimeout(fetch(url, { headers: { Accept: "application/json" } }), 8000);
  if (!r.ok) throw new Error(`Apple RSS failed: ${r.status}`);
  const j = await r.json();
  return (j.feed?.results || []).map((x) => ({
    title: x.name,
    artist: x.artistName,
    desc: "Most played on Apple Music.",
    hashtags: ["#AppleMusic", "#MostPlayed"],
  }));
}

// ---------- Trending builder (cached ~8m) ----------
async function loadTrending({ market = "US", storefront = "us" } = {}) {
  const now = Date.now();
  if (trendingCache.data.length && now < trendingCache.expires) {
    return trendingCache.data;
  }

  const SPOTIFY_TOP50_GLOBAL = "37i9dQZEVXbMDoHDwVN2tF";
  const SPOTIFY_VIRAL50_GLOBAL = "37i9dQZEVXbLiRSasKsNU9";

  let items = [];
  try {
    const [top50, viral50, apple] = await Promise.all([
      getSpotifyPlaylistTracks(SPOTIFY_TOP50_GLOBAL, market, 50),
      getSpotifyPlaylistTracks(SPOTIFY_VIRAL50_GLOBAL, market, 50),
      getAppleMostPlayed(storefront, 50),
    ]);
    items = [...top50, ...viral50, ...apple];
  } catch (e) {
    console.error("[error] Trending sources:", e?.message || e);
  }

  if (!items.length) {
    // safety fallback pool
    items = [
      {
        title: "Espresso",
        artist: "Sabrina Carpenter",
        desc: "Ultra-clippy pre-chorus; edit bait all over FYP.",
        hashtags: ["#Pop", "#Earworm"],
      },
      {
        title: "Birds of a Feather",
        artist: "Billie Eilish",
        desc: "Whisper-pop chorus synced to romance edits.",
        hashtags: ["#AltPop", "#ViralClip"],
      },
      {
        title: "Not Like Us",
        artist: "Kendrick Lamar",
        desc: "Beat switch + chant hooks fueling dance cuts.",
        hashtags: ["#HipHop", "#TikTokSong"],
      },
    ];
  }

  const finalList = shuffle(dedupeByKey(items)).slice(0, 120);
  trendingCache = { data: finalList, expires: now + 8 * 60 * 1000 };
  return finalList;
}

// ---------- OpenAI image (return base64 to avoid CORS issues) ----------
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await withTimeout(
        openai.images.generate({
          model,
          prompt,
          size: "1024x1024",
          response_format: "b64_json", // force base64
        }),
        15_000
      );
      const b64 = out?.data?.[0]?.b64_json;
      if (b64) return `data:image/png;base64,${b64}`;
    } catch (e) {
      console.error(
        `[images] ${model} failed:`,
        e?.response?.data?.error?.message || e?.message || String(e)
      );
    }
  }
  return null;
}

// ---------- Routes ----------
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

app.get("/api/stats", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ count: imageCount });
});

app.get("/api/trend", async (req, res) => {
  res.set("Cache-Control", "no-store");

  // sanitize inputs
  const market = String(req.query.market || "US").replace(/[^A-Z]/gi, "").slice(0, 5).toUpperCase();
  const storefront = String(req.query.storefront || "us")
    .replace(/[^a-z-]/gi, "")
    .slice(0, 10)
    .toLowerCase();

  try {
    const list = await loadTrending({ market, storefront });
    if (!list.length) throw new Error("No trends available");

    // pick avoiding immediate repeats
    let pick = list[Math.floor(Math.random() * list.length)];
    let tries = 0;
    while (isRecent(`${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`) && tries < 10) {
      pick = list[Math.floor(Math.random() * list.length)];
      tries++;
    }
    pushKey(`${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`);

    const prompt = `Aesthetic cover-art visual for "${pick.title}" by ${pick.artist}. Neon, moody, cinematic lighting, NO text overlay.`;
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;

    return res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc || "Trending right now.",
      hashtags: pick.hashtags || ["#Trending", "#NowPlaying"],
      image: imageUrl, // data:image/png;base64,... or null
      count: imageCount,
    });
  } catch (err) {
    console.error("[error] trend route:", err?.message || err);
    return res.status(200).json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "We couldn’t pull live charts. Showing text-only.",
      hashtags: ["#music", "#trend"],
      image: null,
      count: imageCount,
    });
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("[boot] 323drop live backend on :" + PORT));
