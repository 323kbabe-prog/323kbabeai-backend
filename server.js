// server.js — 323drop Live (Spotify Top 50 USA + Google TTS pipeline: music → desc → image → voice → refresh)
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

/* ---------------- OpenAI ---------------- */
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
let lastImgErr = null;

/* ---------------- Spotify Top 50 USA (short demo list, expand as needed) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami", gender: "mixed" },
  { title: "Your Idol", artist: "Saja Boys", gender: "male" },
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Helpers ---------------- */
function makeFirstPersonDescription(title, artist) {
  return `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. The melody sticks in my head like glue, the vocals feel alive, and every replay makes it more addictive.`;
}
function pickSongAlgorithm() {
  const weightTop = 0.7;
  const pool = Math.random() < weightTop ? TOP50_USA.slice(0, 2) : TOP50_USA.slice(2);
  const idx = Math.floor(Math.pow(Math.random(), 1.5) * pool.length);
  return pool[idx];
}
async function nextNewestPick() {
  const pick = pickSongAlgorithm();
  return { ...pick, hashtags: ["#NowPlaying", "#AIFavorite"] };
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
      console.error("❌ Image generation error:", lastImgErr);
    }
  }
  return null;
}

/* ---------------- API: Full Pipeline ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    // 1. Song + description
    const pick = await nextNewestPick();
    const description = makeFirstPersonDescription(pick.title, pick.artist);

    // 2. Image (must succeed before continuing)
    const prompt = `${pick.title} by ${pick.artist}`;
    const imageUrl = await generateImageUrl(prompt);
    if (!imageUrl) return res.status(500).json({ error: "Image generation failed" });

    // 3. Voice (Google TTS on description)
    const audioBuffer = await googleTTS(description, "female");
    const audioBase64 = audioBuffer ? audioBuffer.toString("base64") : null;

    // 4. Package full pipeline response
    res.json({
      title: pick.title,
      artist: pick.artist,
      gender: pick.gender,
      description,
      hashtags: pick.hashtags,
      image: imageUrl,
      voice: audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null,
      refresh: 3000 // ms before frontend auto-refresh
    });
  } catch (e) {
    console.error("❌ Trend pipeline failed:", e);
    res.status(500).json({ error: "Pipeline failed" });
  }
});

/* ---------------- Health + Diag ---------------- */
app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323drop live backend on :${PORT}`));
