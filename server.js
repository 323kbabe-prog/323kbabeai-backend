// server.js — 323drop Live (Spotify Top 50 USA + Gender + Algorithm + Google TTS default + OpenAI fallback + Pre-gen)
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
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 1.0,
      pitch: style === "female" ? 0.0 : -2.0 // neutral pitch range
    }
  });

  console.log("🔎 Google TTS voice:", voice);
  if (!response.audioContent) {
    console.error("❌ No audio returned for:", text);
    return null;
  }

  console.log("✅ Google TTS audio length:", response.audioContent.length);

  // Proper base64 decoding
  return Buffer.from(response.audioContent, "base64");
}

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Spotify Top 50 USA (short list demo, expand as needed) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami", gender: "mixed" },
  { title: "Your Idol", artist: "Saja Boys", gender: "male" },
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Helpers ---------------- */
function makeFirstPersonDescription(title, artist) {
  return `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal.`;
}
function pickSongAlgorithm() {
  const weightTop = 0.7;
  const pool = Math.random() < weightTop ? TOP50_USA.slice(0, 2) : TOP50_USA.slice(2);
  const idx = Math.floor(Math.pow(Math.random(), 1.5) * pool.length);
  return pool[idx];
}
function chooseVoiceByGender(gender = "neutral") {
  if (gender === "female") return "shimmer";
  if (gender === "male") return "verse";
  if (gender === "mixed") return "shimmer";
  return "alloy";
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

/* ---------------- Continuous pre-gen ---------------- */
async function generateNextPick() {
  if (generatingNext) return;
  generatingNext = true;
  try {
    nextPickCache = await nextNewestPick();
  } catch (e) {
    console.error("Pre-gen failed:", e.message);
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
    result = { ...pick, image: null, count: ++imageCount };
    generateNextPick();
  }
  res.json(result);
});

/* ---------------- Voice (Google default, OpenAI fallback) ---------------- */
app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    const source = req.query.source || "google"; // default Google
    const style = req.query.style || "female";   // female | male
    const gender = req.query.gender || "neutral";

    if (!text) return res.status(400).json({ error: "Missing text" });

    let audioBuffer;

    if (source === "openai") {
      const out = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: chooseVoiceByGender(gender),
        input: text,
      });
      audioBuffer = Buffer.from(await out.arrayBuffer());
    } else {
      audioBuffer = await googleTTS(text, style);
    }

    if (!audioBuffer) {
      return res.status(500).json({ error: "No audio generated" });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) {
    console.error("TTS failed", e);
    res.status(500).json({ error: "TTS failed" });
  }
});

/* ---------------- Quick Google TTS Test ---------------- */
app.get("/api/test-google", async (_req, res) => {
  try {
    const audioBuffer = await googleTTS("Google TTS is working right now", "female");
    if (!audioBuffer) return res.status(500).json({ error: "No audio generated" });

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) {
    console.error("Test TTS failed", e);
    res.status(500).json({ error: "Test TTS failed" });
  }
});

app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
  generateNextPick();
});
