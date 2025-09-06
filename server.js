// server.js — 323drop Live (Spotify Top 50 USA + Gender + Algorithm + Google TTS + Pre-gen)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const textToSpeech = require("@google-cloud/text-to-speech");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI (for images) ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

/* ---------------- Google TTS ---------------- */
const googleTTSClient = new textToSpeech.TextToSpeechClient();

async function googleTTS(text, style = "female") {
  const voiceMap = {
    female: { languageCode: "en-US", name: "en-US-Neural2-F", ssmlGender: "FEMALE" },
    male:   { languageCode: "en-US", name: "en-US-Neural2-D", ssmlGender: "MALE" }
  };
  const voice = voiceMap[style] || voiceMap.female;

  const [response] = await googleTTSClient.synthesizeSpeech({
    input: { text },
    voice,
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0.0 }
  });

  if (!response.audioContent) {
    console.error("❌ Google TTS returned no audio for:", text);
    return null;
  }

  console.log("✅ Google TTS audio length:", response.audioContent.length);
  return Buffer.from(response.audioContent);
}

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Spotify Top 50 USA (Sept 2025, with gender) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Your Idol", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast", gender: "male" },
  { title: "Soda Pop", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast", gender: "male" },
  // ... rest unchanged ...
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Style Presets ---------------- */
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

/* ---------------- Helpers ---------------- */
function makeFirstPersonDescription(title, artist) {
  return `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. The melody sticks in my head like glue, the vocals feel alive, and every replay makes it more addictive. It’s one of those tracks that changes the whole mood of the room.`;
}
function pickSongAlgorithm() {
  const weightTop = 0.7;
  const pool = Math.random() < weightTop ? TOP50_USA.slice(0, 20) : TOP50_USA.slice(20);
  const idx = Math.floor(Math.pow(Math.random(), 1.5) * pool.length);
  return pool[idx];
}
function stylizedPrompt(title, artist, gender, styleKey = DEFAULT_STYLE) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    `Audience: Gen-Z fan culture. Visual goal: ${s.description}.`,
    "Make an ORIGINAL idol-like face and styling; do NOT replicate real celebrities.",
    "No text, logos, or watermarks.",
    "Square 1:1 composition.",
    `The performer should appear as a young ${gender} Korean idol (Gen-Z style).`,
    ...s.tags.map(t => `• ${t}`)
  ].join(" ");
}

/* ---------------- AI Favorite Pick ---------------- */
async function nextNewestPick() {
  const pick = pickSongAlgorithm();
  return {
    title: pick.title,
    artist: pick.artist,
    gender: pick.gender,
    description: makeFirstPersonDescription(pick.title, pick.artist),
    hashtags: ["#NowPlaying", "#AIFavorite"]
  };
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await openai.images.generate({ model, prompt, size: "1024x1024", response_format: "b64_json" });
      const d = out?.data?.[0];
      if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
      if (d?.url) return d.url;
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
    const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;
    nextPickCache = { ...pick, image: imageUrl, count: imageCount };
  } finally {
    generatingNext = false;
  }
}

/* ---------------- API Routes ---------------- */
app.get("/api/trend", async (_req, res) => {
  let result;
  if (nextPickCache) {
    result = nextPickCache; nextPickCache = null; generateNextPick();
  } else {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;
    result = { ...pick, image: imageUrl, count: imageCount };
    generateNextPick();
  }
  res.json(result);
});

app.get("/api/trend-stream", async (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15015);

  try {
    let pick;
    if (nextPickCache) { pick = nextPickCache; nextPickCache = null; generateNextPick(); }
    else { pick = await nextNewestPick(); const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender); pick.image = await generateImageUrl(prompt); if (pick.image) imageCount += 1; pick.count = imageCount; generateNextPick(); }

    send("trend", pick);
    if (pick.image) { send("count", { count: pick.count }); send("image", { src: pick.image }); send("status", { msg: "done" }); send("end", { ok:true }); }
    else { send("status", { msg: "image unavailable." }); send("end", { ok:false }); }
  } catch (e) {
    send("status", { msg: `error: ${e.message}` }); send("end", { ok:false });
  } finally {
    clearInterval(hb); res.end();
  }
});

/* ---------------- Voice (Google TTS only) ---------------- */
app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    const style = req.query.style || "female"; // female | male
    if (!text) return res.status(400).json({ error: "Missing text" });

    const audioBuffer = await googleTTS(text, style);
    if (!audioBuffer) return res.status(500).json({ error: "No audio generated" });

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) {
    console.error("Google TTS failed", e);
    res.status(500).json({ error: "TTS failed" });
  }
});

app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));
app.get("/api/stats", (_req,res) => res.json({ count: imageCount }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`323drop live backend on :${PORT}`); generateNextPick(); });
