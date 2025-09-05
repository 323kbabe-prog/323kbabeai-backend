// server.js — 323drop Live (Gen-Z fans styles + title/Spotify vibe + SSE + fallbacks + inspo notes)
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

/* ---------------- Gen-Z fans style system ---------------- */
const STYLE_PRESETS = {
  "stan-photocard": {
    description: "lockscreen-ready idol photocard vibe for Gen-Z fan culture",
    tags: [
      "square 1:1 cover, subject centered, shoulders-up or half-body",
      "flash-lit glossy skin with subtle K-beauty glow",
      "pastel gradient background (milk pink, baby blue, lilac) with haze",
      "sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
      "tiny glitter bokeh and lens glints",
      "clean studio sweep look; light falloff; subtle film grain",
      "original influencer look — not a specific or real celebrity face"
    ]
  },
  "poster-wall": {
    description: "DIY bedroom poster wall — shareable fan collage energy",
    tags: [
      "layered paper textures with tape corners and torn edges",
      "implied magazine clippings WITHOUT readable text or logos",
      "pastel + neon accents, soft shadowed layers",
      "subject in front with crisp rim light; background defocused collage",
      "sparkle confetti and star cutouts; tasteful grain",
      "original, non-celeb face with pop-idol charisma"
    ]
  },
  "glow-stage-fan": {
    description: "arena lightstick glow — concert-night fan moment",
    tags: [
      "dark stage background with colorful beam lights and haze",
      "bokeh crowd dots; generic lightstick silhouettes (no branding)",
      "hot rim light on hair and shoulders; motion vibe",
      "bold neon accents (electric cyan, hot pink, laser purple)",
      "no text, no numbers, no logos; original performer vibe"
    ]
  },
  "y2k-stickerbomb": {
    description: "Y2K candycore — playful stickerbomb pop aesthetic",
    tags: [
      "candy tones (cotton-candy pink, lime soda, sky cyan); glossy highlights",
      "airbrush hearts and starbursts as shapes only",
      "phone-camera flash look with mild bloom",
      "floating sticker motifs around subject; keep face clean",
      "no typography; original pop-idol energy"
    ]
  },
  "street-fandom": {
    description: "urban fan-cam energy — trendy city-night shareability",
    tags: [
      "city night backdrop; neon sign SHAPES only (no readable words)",
      "low-angle phone-cam feel; slight motion trail on hair/jackets",
      "wet asphalt reflections; cinematic contrast",
      "light leak edges; tiny dust particles",
      "original influencer face; not a real celebrity"
    ]
  }
};

const DEFAULT_STYLE = process.env.DEFAULT_STYLE || "stan-photocard";

/* ---------------- Title → vibe tags ---------------- */
function vibeFromTitle(title = "") {
  const MAP = [
    { re: /(love|heart|kiss)/i,      tags: ["warm pink–peach palette", "heart sticker shapes"] },
    { re: /(night|midnight|moon)/i,  tags: ["deep blue–purple palette", "neon rim light"] },
    { re: /(star|shine|glow)/i,      tags: ["sparkle star bokeh", "beam glow accents"] },
    { re: /(cry|tears|sad)/i,        tags: ["soft blue haze", "pearlescent highlights", "droplet bokeh"] },
    { re: /(fire|hot|burn|flame)/i,  tags: ["red–orange accents", "heat-shimmer blur"] },
    { re: /(summer|sun|beach)/i,     tags: ["golden-hour light", "warm film grain"] },
    { re: /(ice|cold|snow|winter)/i, tags: ["icy cyan palette", "crystal sparkles"] },
    { re: /(idol|fan|stan)/i,        tags: ["photocard framing", "soft flash + sparkle sticker shapes"] },
    { re: /(dance|party|move|groove|bounce)/i, tags: ["motion trails", "confetti micro-particles"] }
  ];
  const out = new Set();
  for (const m of MAP) if (m.re.test(title)) m.tags.forEach(t => out.add(t));
  return [...out];
}

/* ---------------- Inspiration notes (style-only, not likeness) ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. I can see why everyone is talking about it right now.`,
    `When “${title}” comes on, I can’t help but stop scrolling and let it run. ${artist} really caught a wave with this one.`,
    `I’ve had “${title}” by ${artist} stuck in my head all day. It’s addictive in the best way and feels like the soundtrack of this moment.`,
    `Listening to “${title}” makes me feel like I’m in on the trend before it blows up. ${artist} nailed the energy here.`,
    `Every time I hear “${title}” by ${artist}, I get that rush that only a viral track can bring. It’s already part of my daily playlist.`
  ];
  return options[Math.floor(Math.random() * options.length)];
}

function inspoToTags(inspo = "") {
  const chunks = String(inspo).split(/[,|]/).map(s => s.trim()).filter(Boolean);
  return chunks.slice(0, 8).map(x => `inspired detail: ${x}`);
}

/* ---------------- Spotify — optional audio features → vibe ---------------- */
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
      { title: "Espresso",           artist: "Sabrina Carpenter", desc: "Viral chorus hooks.",        hashtags: ["#Pop","#Earworm"] },
      { title: "Birds of a Feather", artist: "Billie Eilish",     desc: "Romance edit magnet.",       hashtags: ["#AltPop","#Viral"] },
      { title: "Not Like Us",        artist: "Kendrick Lamar",    desc: "Chant hooks & dance edits.", hashtags: ["#HipHop","#TikTokSong"] },
    ];
  }

  // ✅ FIX: keep natural order (newest/top → oldest), no shuffle
  trendingCache = { data: dedupeByKey(items).slice(0, 120), expires: now + 8*60*1000 };
  return trendingCache.data;
}

async function getAudioFeaturesBySearch(title, artist, market = "US") {
  const token = await getSpotifyToken();
  const url = new URL("https://api.spotify.com/v1/search");
  url.searchParams.set("q", `track:${title} artist:${artist}`);
  url.searchParams.set("type", "track");
  url.searchParams.set("limit", "1");
  url.searchParams.set("market", market);

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Spotify search failed: ${r.status}`);
  const j = await r.json();
  const tr = j?.tracks?.items?.[0];
  if (!tr) return null;

  const fr = await fetch(`https://api.spotify.com/v1/audio-features/${tr.id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!fr.ok) throw new Error(`audio-features failed: ${fr.status}`);
  return await fr.json();
}
function visualHintsFromAudio(f) {
  const tags = [];
  if (f.energy >= 0.7)  tags.push("high-contrast lighting, neon edge highlights");
  else                  tags.push("soft pastel lighting with gentle bloom");
  if (f.valence >= 0.6) tags.push("optimistic warm color cast"); else tags.push("cool moody color cast");
  if (f.danceability >= 0.7) tags.push("dynamic motion echoes around hair and sleeves");
  if (f.tempo > 140) tags.push("staccato shutter trails and spark particles");
  if (f.acousticness >= 0.6) tags.push("organic texture, subtle film grain");
  return tags;
}

/* ---------------- Prompt builder (fans + inspo) ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE, extraVibe = [], inspoTags = []) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    ...s.tags.map(t => `• ${t}`),
    ...(extraVibe.length ? ["Vibe details:", ...extraVibe.map(t => `• ${t}`)] : []),
    ...(inspoTags.length ? ["Inspiration notes (style only, not likeness):", ...inspoTags.map(t => `• ${t}`)] : [])
  ].join(" ");
}

/* ---------------- Image generation + fallbacks ---------------- */
// ... (rest of your file unchanged) ...
