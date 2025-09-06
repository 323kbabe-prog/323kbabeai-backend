// server.js — 323drop Live (Spotify Top 50 USA + Pre-gen + OpenAI description/images + Google TTS voice + Failsafe)
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
      console.error("❌ Google TTS returned no audio for:", text);
      return null;
    }
    console.log("✅ Google TTS audio length:", response.audioContent.length);
    return Buffer.from(response.audioContent, "binary");
  } catch (e) {
    console.error("❌ Google TTS error:", e.message);
    return null;
  }
}

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Spotify Top 50 ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  // … include all 50 songs you listed …
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Helpers ---------------- */
async function makeFirstPersonDescription(title, artist) {
  try {
    const prompt = `
      Write a minimum 70-word first-person description of the song "${title}" by ${artist}.
      Mimic the artist’s mood and style (e.g., Billie Eilish = moody, Eminem = intense, Taylor Swift = storytelling).
      Make it sound natural, Gen-Z relatable, and like the artist is speaking.
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
    return `“${title}” by ${artist} is unforgettable, replay-worthy, and instantly addictive.`;
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
    "• flash-lit glossy skin with subtle K-beauty glow",
    "• pastel gradient background (milk pink, baby blue, lilac) with haze",
    "• sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
    "• tiny glitter bokeh and lens glints",
    "• clean studio sweep look; subtle film grain"
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  try {
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
    let voiceBase64 = null;
    try {
      const audioBuffer = await googleTTS(description, style);
      if (audioBuffer) voiceBase64 = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    } catch {}
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
    if (!result) {
      result = {
        title: "Fallback Song",
        artist: "Unknown",
        gender: "neutral",
        description: "This is a fallback drop while the system retries.",
        hashtags: ["#NowPlaying"],
        image: "https://placehold.co/600x600?text=No+Image",
        voice: null,
        refresh: null
      };
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

app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    const style = req.query.style || "female";
    if (!text) return res.status(400).json({ error: "Missing text" });
    const audioBuffer = await googleTTS(text, style);
    if (!audioBuffer) return res.status(500).json({ error: "No audio generated" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) {
    res.status(500).json({ error: "Voice TTS failed" });
  }
});

app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));
app.get("/api/stats", (_req,res) => res.json({ count: imageCount }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
  generateNextPick();
});
