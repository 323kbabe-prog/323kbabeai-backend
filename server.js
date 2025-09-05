// server.js — 323drop Live (Gen‑Z fans styles + title/Spotify vibe + SSE + fallbacks + inspo notes)
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
const shuffle = (a) => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const dedupeByKey = (items) => {
  const seen = new Set();
  return items.filter(x => {
    const k = `${(x.title||"").toLowerCase()}::${(x.artist||"").toLowerCase()}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
};

/* ---------------- Gen‑Z fans style system ---------------- */
const STYLE_PRESETS = {
  "stan-photocard": {
    description: "lockscreen-ready idol photocard vibe for Gen‑Z fan culture",
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

/* ---------------- Prompt builder (fans + inspo) ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE, extraVibe = [], inspoTags = []) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    `Audience: Gen‑Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    ...s.tags.map(t => `• ${t}`),
    ...(extraVibe.length ? ["Vibe details:", ...extraVibe.map(t => `• ${t}`)] : []),
    ...(inspoTags.length ? ["Inspiration notes (style only, not likeness):", ...inspoTags.map(t => `• ${t}`)] : [])
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

async function getImageWithFallback(pick, prompt) {
  const img = await generateImageUrl(prompt);
  if (img) return img;
  const art = await fallbackArtwork(pick);
  if (art) return art;
  return neonSvgPlaceholder(`${pick.title}|${pick.artist}`);
}

async function nextNewestPick({ market = "US", storefront = "us" } = {}) {
  const list = await loadTrending({ market, storefront });

  if (!trendList.length) {
    trendList = dedupeByKey([...list]); // newest→oldest
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

/* ---------------- Diagnostics ---------------- */
app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/diag/env", (_req,res) => res.json({
  has_OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
  has_OPENAI_ORG_ID:  Boolean(process.env.OPENAI_ORG_ID),
  has_SPOTIFY_ID:     Boolean(process.env.SPOTIFY_CLIENT_ID),
  has_SPOTIFY_SECRET: Boolean(process.env.SPOTIFY_CLIENT_SECRET),
  DEFAULT_STYLE,
  node: process.version,
}));
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
  const send = (ev, data) => res.write(`event: ${ev}
data: ${JSON.stringify(data)}

`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15015);

  send("hello", { ok: true });

  let pick;
  try {
    send("status", { msg: "fetching live trends…" });
    const market = String(req.query.market || "US").toUpperCase();
    const list = await loadTrending({ market, storefront: "us" });
    pick = await nextNewestPick({ market });
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;

    const styleKey  = String(req.query.style || DEFAULT_STYLE);
    const inspoTags = inspoToTags(req.query.inspo || "");
    const titleTags = vibeFromTitle(pick.title);
    let audioTags = [];
    try {
      const f = await getAudioFeaturesBySearch(pick.title, pick.artist, market);
      if (f) audioTags = visualHintsFromAudio(f);
    } catch (e) { /* optional */ }

    const prompt = stylizedPrompt(pick.title, pick.artist, styleKey, [...titleTags, ...audioTags], inspoTags);
    send("status", { msg: "generating image…" });
    const imageUrl = await getImageWithFallback(pick, prompt);
    if (lastImgErr) send("diag", lastImgErr);

    send("trend", {
      title: pick.title,
      artist: pick.artist,
      description: (pick.desc || "Trending right now.") + " " + makeFirstPersonDescription(pick.title, pick.artist),
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
    const list = await loadTrending({ market, storefront: "us" });
    let pick = await nextNewestPick({ market });
    const key = `${pick.title.toLowerCase()}::${pick.artist.toLowerCase()}`;
    if (key === lastKey && list.length > 1) {
      pick = list.find(x => `${x.title.toLowerCase()}::${x.artist.toLowerCase()}` !== lastKey) || pick;
    }
    lastKey = key;

    const styleKey  = String(req.query.style || DEFAULT_STYLE);
    const inspoTags = inspoToTags(req.query.inspo || "");
    const titleTags = vibeFromTitle(pick.title);
    let audioTags = [];
    try {
      const f = await getAudioFeaturesBySearch(pick.title, pick.artist, market);
      if (f) audioTags = visualHintsFromAudio(f);
    } catch {}

    const prompt = stylizedPrompt(pick.title, pick.artist, styleKey, [...titleTags, ...audioTags], inspoTags);
    const imageUrl = await getImageWithFallback(pick, prompt);
    if (imageUrl) imageCount += 1;

    res.json({
      title: pick.title,
      artist: pick.artist,
      description: (pick.desc || "Trending right now.") + " " + makeFirstPersonDescription(pick.title, pick.artist),
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
  console.log("OpenAI key present:", !!process.env.OPENAI_API_KEY, "| Org set:", !!process.env.OPENAI_ORG_ID, "| Default style:", DEFAULT_STYLE);
});
