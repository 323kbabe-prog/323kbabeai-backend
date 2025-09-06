// server.js — 323drop Live (GPT 2025 Song Pick + Image + TTS)
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
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Style presets ---------------- */
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
  }
};
const DEFAULT_STYLE = process.env.DEFAULT_STYLE || "stan-photocard";

/* ---------------- Description Helper ---------------- */
function makeFirstPersonDescription(title, artist) {
  return `i just listened to “${title}” by ${artist}, a 2025 drop, and the vibe is unreal — it feels like the anthem of this year.`;
}

/* ---------------- Song pick using GPT only (2025) ---------------- */
async function nextNewestPick() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "you are a music trend parser." },
        {
          role: "user",
          content: `Pick ONE trending song from 2025 (Spotify, Apple Music, YouTube, TikTok, Google).
Reply ONLY as JSON { "title": "...", "artist": "..." }.`
        }
      ]
    });

    let pick;
    try {
      pick = JSON.parse(completion.choices[0].message.content);
    } catch {
      pick = { title: "Unknown", artist: "Unknown" };
    }

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      description: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying2025", "#AIFavorite"]
    };
  } catch (e) {
    console.error("song pick failed:", e.message);
    return {
      title: "Fallback Song",
      artist: "AI DJ",
      description: "Fallback track when GPT song pick fails.",
      hashtags: ["#AI"]
    };
  }
}

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    ...s.tags.map(t => `• ${t}`)
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await openai.images.generate({ model, prompt, size: "1024x1024", response_format: "b64_json" });
      const d = out?.data?.[0];
      const b64 = d?.b64_json;
      const url = d?.url;
      if (b64) return `data:image/png;base64,${b64}`;
      if (url)  return url;
    } catch (e) {
      lastImgErr = { model, message: e?.message || String(e) };
    }
  }
  return null;
}

/* ---------------- Continuous pre-gen ---------------- */
async function generateNextPick() {
  if (generatingNext) return;
  generatingNext = true;
  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;
    nextPickCache = {
      title: pick.title,
      artist: pick.artist,
      description: pick.description,
      hashtags: pick.hashtags,
      image: imageUrl,
      count: imageCount
    };
  } finally {
    generatingNext = false;
  }
}

/* ---------------- JSON one-shot with continuous pre-gen ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    let result;
    if (nextPickCache) {
      result = nextPickCache;
      nextPickCache = null;
      generateNextPick();
    } else {
      const pick = await nextNewestPick();
      const prompt = stylizedPrompt(pick.title, pick.artist);
      const imageUrl = await generateImageUrl(prompt);
      if (imageUrl) imageCount += 1;
      result = {
        title: pick.title,
        artist: pick.artist,
        description: pick.description,
        hashtags: pick.hashtags,
        image: imageUrl,
        count: imageCount
      };
      generateNextPick();
    }
    res.json(result);
  } catch {
    res.json({ title: "Fresh Drop", artist: "323KbabeAI", description: "Text-only.", hashtags: ["#music","#trend"], image: null, count: imageCount });
  }
});

/* ---------------- Voice (TTS) ---------------- */
app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    if (!text) return res.status(400).json({ error: "Missing text" });
    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
    });
    const buffer = Buffer.from(await out.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch {
    res.status(500).json({ error: "TTS failed" });
  }
});

/* ---------------- Health ---------------- */
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ 323drop backend live on :${PORT}`);
  generateNextPick();
});
