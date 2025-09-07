// server.js — 323drop Live (Spotify Top 50 + Pre-gen + OpenAI desc/images + Dual TTS: Google first, fallback to OpenAI)
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
});

/* ---------------- Google TTS ---------------- */
const googleTTSClient = new textToSpeech.TextToSpeechClient();

async function googleTTS(text, style = "female") {
  try {
    const voiceMap = {
      female: { languageCode: "en-US", name: "en-US-Neural2-F", ssmlGender: "FEMALE" },
      male:   { languageCode: "en-US", name: "en-US-Neural2-D", ssmlGender: "MALE" }
    };
    const voice = voiceMap[style] || voiceMap.female;

    const [response] = await googleTTSClient.synthesizeSpeech({
      input: { text },
      voice,
      audioConfig: { audioEncoding: "MP3" }
    });

    if (!response.audioContent) {
      console.error("❌ Google TTS returned no audio");
      return null;
    }

    console.log("✅ Google TTS audio length:", response.audioContent.length);
    return Buffer.from(response.audioContent, "binary");
  } catch (e) {
    console.error("❌ Google TTS error:", e.message);
    return null;
  }
}

/* ---------------- OpenAI fallback TTS ---------------- */
async function openaiTTS(text, gender = "neutral") {
  try {
    const voiceMap = {
      female: "shimmer",
      male: "verse",
      neutral: "alloy",
      mixed: "alloy"
    };
    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voiceMap[gender] || "alloy",
      input: text,
    });
    return Buffer.from(await out.arrayBuffer());
  } catch (e) {
    console.error("❌ OpenAI TTS error:", e.message);
    return null;
  }
}

/* ---------------- State ---------------- */
let nextPickCache = null;
let generatingNext = false;
let lastImgErr = null;

/* ---------------- Spotify Top 50 (short sample shown; replace with your full 50) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami", gender: "mixed" },
  { title: "Soda Pop", artist: "Saja Boys", gender: "male" },
  { title: "DAISIES", artist: "Justin Bieber", gender: "male" },
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Helpers ---------------- */
async function makeFirstPersonDescription(title, artist) {
  try {
    console.log("📝 Generating description for:", title, "by", artist);
    const prompt = `
      Write a minimum 70-word first-person description of the song "${title}" by ${artist}.
      Mimic the artist’s mood and style (e.g., Billie Eilish = moody, Eminem = intense, Taylor Swift = storytelling).
      Make it sound natural, Gen-Z relatable, and as if the artist themselves is talking.
    `;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [
        { role: "system", content: "You are a music fan channeling the artist’s voice in first person." },
        { role: "user", content: prompt }
      ]
    });
    return completion.choices[0].message.content.trim();
  } catch (e) {
    console.error("❌ Description failed:", e.message);
    return `“${title}” by ${artist} is unforgettable, replay-worthy, and addictive.`;
  }
}

function pickSongAlgorithm() {
  const weightTop = 0.7;
  let pool = Math.random() < weightTop ? TOP50_USA.slice(0, 20) : TOP50_USA.slice(20);
  if (!pool.length) pool = TOP50_USA;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

function stylizedPrompt(title, artist, gender) {
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    "Audience: Gen-Z fan culture. Visual goal: lockscreen-ready idol photocard vibe.",
    "Make an ORIGINAL idol-like face and styling; do NOT replicate real celebrities.",
    "No text, logos, or watermarks.",
    "Square 1:1 composition.",
    `The performer should appear as a young ${gender} Korean idol (Gen-Z style).`,
    "• pastel gradient background (milk pink, baby blue, lilac)",
    "• glitter bokeh and lens glints",
    "• flash-lit glossy skin with subtle K-beauty glow"
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  try {
    console.log("🎨 Generating image…");
    const out = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"
    });
    const d = out?.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url;
  } catch (e) {
    lastImgErr = { message: e?.message || String(e) };
    console.error("❌ Image gen error:", lastImgErr);
  }
  return "https://placehold.co/600x600?text=No+Image";
}

/* ---------------- Pre-gen ---------------- */
async function generateNextPick(style = "female") {
  if (generatingNext) return;
  generatingNext = true;
  try {
    const pick = pickSongAlgorithm();
    const description = await makeFirstPersonDescription(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(stylizedPrompt(pick.title, pick.artist, pick.gender));

    // Voice (Google first, OpenAI fallback)
    let voiceBase64 = null;
    let audioBuffer = await googleTTS(description, style);
    if (!audioBuffer) audioBuffer = await openaiTTS(description, pick.gender);
    if (audioBuffer) voiceBase64 = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;

    nextPickCache = {
      title: pick.title,
      artist: pick.artist,
      gender: pick.gender,
      description,
      hashtags: ["#NowPlaying", "#AIFavorite"],
      image: imageUrl,
      voice: voiceBase64,
      refresh: voiceBase64 ? 3000 : null
    };
  } finally {
    generatingNext = false;
  }
}

/* ---------------- API Routes ---------------- */
app.get("/api/trend", async (req, res) => {
  try {
    let result;
    if (nextPickCache) {
      result = nextPickCache;
      nextPickCache = null;
      generateNextPick(req.query.style || "female");
    } else {
      await generateNextPick(req.query.style || "female");
      result = nextPickCache;
      nextPickCache = null;
      generateNextPick(req.query.style || "female");
    }
    res.json(result);
  } catch (e) {
    console.error("❌ Trend API error:", e);
    res.json({
      title: "Error Song",
      artist: "System",
      gender: "neutral",
      description: "Something went wrong. Retrying soon…",
      hashtags: ["#Error"],
      image: "https://placehold.co/600x600?text=Error",
      voice: null,
      refresh: null
    });
  }
});

app.get("/api/test-google", async (req, res) => {
  try {
    const text = "Google TTS is working. Hello from 323drop!";
    const style = req.query.style || "female";
    let audioBuffer = await googleTTS(text, style);
    if (!audioBuffer) audioBuffer = await openaiTTS(text, "neutral");
    if (!audioBuffer) return res.status(500).json({ error: "No audio generated" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) {
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
