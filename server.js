// server.js — 323drop Fans Set v2.2
// Adds auto "same gender as artist" via sex=same|auto with a safe mapping.
// Keeps: Gen-Z fans styles + title/Spotify vibe + SSE + fallbacks + inspo notes + heritage + hair/outfit + cover/palette + caching
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = (process.env.CORS_ALLOW || "https://1ai323.ai,https://www.1ai323.ai")
  .split(",").map(s => s.trim()).filter(Boolean);
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

/* ---------------- Config ---------------- */
const DEFAULT_STYLE   = process.env.DEFAULT_STYLE || "stan-photocard";
const CACHE_TTL_MIN   = Number(process.env.CACHE_TTL_MIN || 360); // 6h
const MAX_CACHE_ITEMS = Number(process.env.MAX_CACHE_ITEMS || 200);

/* ---------------- State ---------------- */
let imageCount = 0;
let lastKey = "";
let lastImgErr = null;
let trendingCache = { data: [], expires: 0 };
let spotifyTokenCache = { token: null, expires: 0 };
const imageCache = new Map(); // small LRU-ish cache

function cacheKey(parts) {
  return [
    String(parts.title||"").toLowerCase(),
    String(parts.artist||"").toLowerCase(),
    parts.styleKey||"", parts.inspo||"", parts.sex||"", parts.heritage||"",
    parts.hair||"", parts.outfit||"", parts.cover||"", parts.palette||""
  ].join("||");
}
function setCache(key, val) {
  while (imageCache.size >= MAX_CACHE_ITEMS) {
    const first = imageCache.keys().next().value;
    imageCache.delete(first);
  }
  imageCache.set(key, { ...val, ts: Date.now() });
}
function getCache(key) {
  const hit = imageCache.get(key);
  if (!hit) return null;
  const ageMin = (Date.now() - hit.ts) / 60000;
  if (ageMin > CACHE_TTL_MIN) { imageCache.delete(key); return null; }
  imageCache.delete(key); imageCache.set(key, hit);
  return hit;
}

/* ---------------- Helpers ---------------- */
const shuffle = (a) => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
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

/* ---------------- Style-only controls (no likeness) ---------------- */
function inspoToTags(inspo = "") {
  const chunks = String(inspo).split(/[,|]/).map(s => s.trim()).filter(Boolean);
  return chunks.slice(0, 8).map(x => `inspired detail: ${x}`);
}
function sexToTags(sex = "") {
  const s = String(sex || "").toLowerCase();
  if (!s) return [];
  return [`present the subject as ${s} in appearance and styling; keep it respectful and natural`];
}
function heritageToTags(heritage = "") {
  const h = String(heritage).trim();
  if (!h) return [];
  return [`depict the subject with ${h} heritage respectfully and authentically; avoid caricature or stereotypes`];
}
function hairToTags(hair = "") {
  const t = String(hair).trim();
  if (!t) return [];
  return [`hair styling cue: ${t}`];
}
function outfitToTags(outfit = "") {
  const t = String(outfit).trim();
  if (!t) return [];
  return [`outfit styling cue: ${t}`];
}
function coverToTags(cover = "") {
  const chunks = String(cover).split(/[,|]/).map(s => s.trim()).filter(Boolean);
  return chunks.slice(0, 10).map(x => `cover-art setting cue: ${x}`);
}
function paletteToTags(palette = "") {
  const parts = String(palette).split(/[,|]/).map(s => s.trim()).filter(Boolean);
  const hex = parts.filter(p => /^#?[0-9a-fA-F]{6}$/.test(p)).slice(0, 6).map(p => p.startsWith("#")?p:"#"+p);
  return hex.map(h => `dominant color: ${h}`);
}

/* ---------------- Auto same-gender mapping ---------------- */
const KNOWN_ARTIST_GENDER = {
  // pop (sample; extend as needed)
  "sabrina carpenter": "female",
  "billie eilish": "female",
  "taylor swift": "female",
  "olivia rodrigo": "female",
  "dua lipa": "female",
  "ariana grande": "female",
  "beyonce": "female",
  "ice spice": "female",
  "doja cat": "female",
  "rihanna": "female",
  // k-pop soloists/groups (approximate by group)
  "blackpink": "female",
  "twice": "female",
  "newjeans": "female",
  "le sserafim": "female",
  "itzy": "female",
  "iu": "female",
  "bts": "male",
  "stray kids": "male",
  "seventeen": "male",
  "ateez": "male",
  "taemin": "male",
  // hip-hop
  "kendrick lamar": "male",
  "drake": "male",
  "travis scott": "male",
  // others
  "justin bieber": "male",
  "the weeknd": "male",
  "bad bunny": "male"
};
function resolveSexForArtist(artist, sexParam) {
  const s = String(sexParam||"").toLowerCase().trim();
  if (s && s !== "same" && s !== "auto") return s; // explicit value wins
  const key = String(artist||"").toLowerCase().trim();
  const mapped = KNOWN_ARTIST_GENDER[key];
  return mapped || ""; // empty means "unknown" -> no tag
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
  trendingCache = { data: shuffle(dedupeByKey(items)).slice(0, 120), expires: now + 8*60*1000 };
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

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE, extraVibe = [], tags = []) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    ...s.tags.map(t => `• ${t}`),
    ...(extraVibe.length ? ["Vibe details:", ...extraVibe.map(t => `• ${t}`)] : []),
    ...(tags.length ? ["Specific styling (no likeness):", ...tags.map(t => `• ${t}`)] : []),
  ].join(" ");
}

/* ---------------- Image generation + fallbacks ---------------- */
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await openai.images.generate({ model, prompt, size: "1024x1024", response_format: "b64_json" });
        const d = out?.data?.[0];
        const b64 = d?.b64_json;
        const url = d?.url;
        if (b64) return `data:image/png;base64,${b64}`;
        if (url)  return url;
      } catch (e) {
        lastImgErr = {
          model, attempt: attempt + 1,
          status: e?.status || e?.response?.status || null,
          message: e?.response?.data?.error?.message || e?.message || String(e),
        };
        console.error("[images]", lastImgErr);
        if (lastImgErr.status === 403) break;
        if (lastImgErr.status === 429 || /timeout|ECONNRESET|ETIMEDOUT/i.test(lastImgErr.message)) {
          await sleep(300 + Math.random()*300); continue;
        }
      }
      break;
    }
  }
  return null;
}

// iTunes artwork fallback (preview use)
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
    return a.replace(/60x60bb(\.(jpg|png))/, "1000x1000bb$1").replace(/100x100bb(\.(jpg|png))/, "1000x1000bb$1");
  } catch { return null; }
}

// Neon SVG placeholder (always available)
function neonSvgPlaceholder(seed) {
  const n = Array.from(seed).reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0)>>>0;
  const hue = (x)=> (x % 360);
  const h1 = hue(n), h2 = hue(n*3+120), h3 = hue(n*7+240);
  const star = (cx,cy,r,spikes=6)=>{ let p=""; const step=Math.PI/spikes;
    for(let i=0;i<spikes*2;i++){ const ang=i*step, rad=i%2? r*0.45 : r; const x=cx+Math.cos(ang)*rad, y=cy+Math.sin(ang)*rad; p+=(i?"L":"M")+x.toFixed(1)+","+y.toFixed(1); }
    return p+"Z";
  };
  const svg = `
  <svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024'>
    <defs>
      <radialGradient id='g' cx='50%' cy='50%'>
        <stop offset='0%'   stop-color='hsl(${h1},100%,60%)'/>
        <stop offset='55%'  stop-color='hsl(${h2},100%,55%)'/>
        <stop offset='100%' stop-color='hsl(${h3},100%,45%)'/>
      </radialGradient>
      <filter id='glow'><feGaussianBlur stdDeviation='8' result='b'/><feMerge><feMergeNode in='b'/><feMergeNode in='SourceGraphic'/></feMerge></filter>
    </defs>
    <rect width='1024' height='1024' fill='url(#g)'/>
    <path d='${star(280,300,120,6)}' fill='none' stroke='white' stroke-opacity='.35' stroke-width='6' filter='url(#glow)'/>
    <path d='${star(720,700,160,7)}' fill='none' stroke='white' stroke-opacity='.28' stroke-width='5' filter='url(#glow)'/>
    <circle cx='512' cy='512' r='280' fill='none' stroke='white' stroke-opacity='.18' stroke-width='4' filter='url(#glow)'/>
  </svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

async function getImageWithFallback(pick, prompt, keyParts) {
  const key = cacheKey({ title: pick.title, artist: pick.artist, ...keyParts });
  const hit = getCache(key);
  if (hit) return hit.image;

  const img = await generateImageUrl(prompt);
  if (img) { setCache(key, { image: img }); return img; }
  const art = await fallbackArtwork(pick);
  if (art) { setCache(key, { image: art }); return art; }
  const svg = neonSvgPlaceholder(`${pick.title}|${pick.artist}`);
  setCache(key, { image: svg });
  return svg;
}

/* ---------------- Diagnostics ---------------- */
app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/diag/env", (_req,res) => res.json({
  has_OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
  has_OPENAI_ORG_ID:  Boolean(process.env.OPENAI_ORG_ID),
  has_SPOTIFY_ID:     Boolean(process.env.SPOTIFY_CLIENT_ID),
  has_SPOTIFY_SECRET: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
  DEFAULT_STYLE,
  ALLOW,
  node: process.version,
}));
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get("/api/styles", (_req, res) => res.json({ defaults: DEFAULT_STYLE, presets: Object.keys(STYLE_PRESETS) }));
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

  try {
    send("status", { msg: "fetching live trends…" });
    const market = String(req.query.market || "US").toUpperCase();
    const styleKey  = String(req.query.style || DEFAULT_STYLE);
    const inspoTags = inspoToTags(req.query.inspo || "");
    const heritageTags = heritageToTags(req.query.heritage || req.query.race || "");
    const hairTags  = hairToTags(req.query.hair || "");
    const outfitTags= outfitToTags(req.query.outfit || "");
    const coverTags = coverToTags(req.query.cover || "");
    const paletteTags = paletteToTags(req.query.palette || "");

    const list = await loadTrending({ market, storefront: "us" });
    let pick = list[Math.floor(Math.random() * list.length)];
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;

    // Auto sex mapping when sex=same|auto
    const resolvedSex = resolveSexForArtist(pick.artist, req.query.sex || "");
    const sexTags = sexToTags(resolvedSex);

    const titleTags = vibeFromTitle(pick.title);
    let audioTags = [];
    try {
      const f = await getAudioFeaturesBySearch(pick.title, pick.artist, market);
      if (f) audioTags = visualHintsFromAudio(f);
    } catch {}

    const tags = [
      ...inspoTags, ...sexTags, ...heritageTags, ...hairTags, ...outfitTags, ...coverTags, ...paletteTags
    ];
    const prompt = stylizedPrompt(pick.title, pick.artist, styleKey, [...titleTags, ...audioTags], tags);
    send("status", { msg: "generating image…" });
    const imageUrl = await getImageWithFallback(pick, prompt, {
      title: pick.title, artist: pick.artist, styleKey,
      inspo: req.query.inspo || "", sex: resolvedSex || (req.query.sex || ""), heritage: req.query.heritage || req.query.race || "",
      hair: req.query.hair || "", outfit: req.query.outfit || "", cover: req.query.cover || "", palette: req.query.palette || ""
    });
    if (lastImgErr) send("diag", lastImgErr);

    send("trend", {
      title: pick.title,
      artist: pick.artist,
      description: pick.desc || "Trending right now.",
      hashtags: pick.hashtags || ["#Trending","#NowPlaying"]
    });

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

/* ---------------- JSON one-shot ---------------- */
app.get("/api/trend", async (req, res) => {
  try {
    const market = String(req.query.market || "US").toUpperCase();
    const styleKey  = String(req.query.style || DEFAULT_STYLE);
    const inspoTags = inspoToTags(req.query.inspo || "");
    const heritageTags = heritageToTags(req.query.heritage || req.query.race || "");
    const hairTags  = hairToTags(req.query.hair || "");
    const outfitTags= outfitToTags(req.query.outfit || "");
    const coverTags = coverToTags(req.query.cover || "");
    const paletteTags = paletteToTags(req.query.palette || "");

    const list = await loadTrending({ market, storefront: "us" });
    let pick = list[Math.floor(Math.random() * list.length)];
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;

    // Auto sex mapping when sex=same|auto
    const resolvedSex = resolveSexForArtist(pick.artist, req.query.sex || "");
    const sexTags = sexToTags(resolvedSex);

    const titleTags = vibeFromTitle(pick.title);
    let audioTags = [];
    try {
      const f = await getAudioFeaturesBySearch(pick.title, pick.artist, market);
      if (f) audioTags = visualHintsFromAudio(f);
    } catch {}

    const tags = [
      ...inspoTags, ...sexTags, ...heritageTags, ...hairTags, ...outfitTags, ...coverTags, ...paletteTags
    ];
    const prompt = stylizedPrompt(pick.title, pick.artist, styleKey, [...titleTags, ...audioTags], tags);
    const imageUrl = await getImageWithFallback(pick, prompt, {
      title: pick.title, artist: pick.artist, styleKey,
      inspo: req.query.inspo || "", sex: resolvedSex || (req.query.sex || ""), heritage: req.query.heritage || req.query.race || "",
      hair: req.query.hair || "", outfit: req.query.outfit || "", cover: req.query.cover || "", palette: req.query.palette || ""
    });
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
  console.log(`323drop fans set v2.2 backend on :${PORT}`);
  console.log("OpenAI key present:", !!process.env.OPENAI_API_KEY, "| Org set:", !!process.env.OPENAI_ORG_ID, "| Default style:", DEFAULT_STYLE);
});
