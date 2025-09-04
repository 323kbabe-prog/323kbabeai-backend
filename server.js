// server.js — 323drop Live (Gen-Z fans styles + title/Spotify vibe + SSE + fallbacks)
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
    { re: /(cry|tears|sad)/i,        tags: ["soft blue haze", "pearlesce]()
