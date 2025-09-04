// server.js — 323drop Live (stylized/original-face images, robust; diagnostics)
// CommonJS; Node >= 20

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici"); // reliable fetch on Node 20

const app = express();

// --- CORS: allow your domains ---
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

// --- OpenAI (make org optional to avoid mismatches) ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

// --- State ---
let imageCount = 0;
let lastKey = "";
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };

// --- Helpers ---
const shuffle = (a) => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const dedupeByKey = (items) => {
  const seen = new Set();
  return items.filter(x => {
    const k = `${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
};

// --- Spotify & Apple (live trends) ---
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
      { title: "Espresso",           artist: "Sabrina Carpenter", desc: "Viral chorus hooks.",       hashtags: ["#Pop","#Earworm"] },
      { title: "Birds of a Feather", artist: "Billie Eilish",     desc: "Romance edit magnet.",      hashtags: ["#AltPop","#Viral"] },
      { title: "Not Like Us",        artist: "Kendrick Lamar",    desc: "Chant hooks & dance edits.",hashtags: ["#HipHop","#TikTokSong"] },
    ];
  }
  trendingCache = { data: shuffle(dedupeByKey(items)).slice(0, 120), expires: now + 8*60*1000 };
  return trendingCache.data;
}

// --- Image generation (stylized/original face; diagnostics) ---
let lastImgErr = null;

function stylizedPrompt(title, artist) {
  return (
    `Square album-cover image for "${title}" by ${artist}. ` +
    `Stylized (not photoreal), high-contrast neon/moody lighting, abstract shapes and motion cues. ` +
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
        const out = await openai.images.generate({ model, prompt, size: "1024x1024" });
        const d = out?.data?.[0];
        const url = d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null);
        if (url) return url;
      } catch (e) {
        lastImgErr = {
          model,
          attempt: attempt + 1,
          status: e?.status || e?.response?.status || null,
          message: e?.response?.data?.error?.message || e?.message || String(e),
        };
        console.error("[images]", lastImgErr);
        if (lastImgErr.status === 403) break; // org-gated → next model
        if (lastImgErr.status === 429 || /timeout|ECONNRESET|ETIMEDOUT/i.test(lastImgErr.message)) {
          await sleep(300 + Math.random()*200); continue;
        }
      }
      break;
    }
  }
  return null;
}

// Diagnostics
app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));

// --- Routes ---
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

app.get("/api/stats", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ count: imageCount });
});

app.get("/api/trend", async (req, res) => {
  const market     = String(req.query.market || "US").toUpperCase();
  const storefront = String(req.query.storefront || "us").toLowerCase();

  try {
    const list = await loadTrending({ market, storefront });
    if (!list.length) throw new Error("No trends available");

    // pick & avoid repeat
    let pick = list[Math.floor(Math.random() * list.length)];
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;

    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;

    return res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc || "Trending right now.",
      hashtags: pick.hashtags || ["#Trending","#NowPlaying"],
      image: imageUrl,             // https://... or data:image/...
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

// --- Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323drop live backend on :${PORT}`));
