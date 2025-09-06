// server.js — 323drop Live (Spotify Top 50 USA + OpenAI description + OpenAI images + Google TTS voice + Debug logs)
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

    // ✅ Debug logs
    console.log("✅ Google TTS audio generated");
    console.log("   Text:", text.slice(0, 60) + (text.length > 60 ? "..." : ""));
    console.log("   Voice style:", style);
    console.log("   Audio length:", response.audioContent.length);

    return Buffer.from(response.audioContent, "binary");
  } catch (e) {
    console.error("❌ Google TTS error:", e.message);
    return null;
  }
}

/* ---------------- Spotify Top 50 (Sept 2025, with gender) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Your Idol", artist: "Saja Boys", gender: "male" },
  // ... include the rest of your 50 songs ...
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Helpers ---------------- */
async function makeFirstPersonDescription(title, artist) {
  try {
    const prompt = `
      Write a minimum 70-word first-person description of the song "${title}" by ${artist}.
      Mimic the artist’s personality, mood, and style (e.g., Billie Eilish = moody, Eminem = intense, Taylor Swift = storytelling).
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
    console.error("❌ OpenAI description failed:", e.message);
    return `“${title}” by ${artist} is a track I can’t stop replaying. The energy grabs me instantly and every line feels alive. It’s unforgettable.`;
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
    "Absolutely no text, logos, or watermarks.",
    "Square 1:1 composition.",
    `The performer should appear as a young ${gender} Korean idol (Gen-Z style).`,
    "• square 1:1 cover, subject centered, shoulders-up or half-body",
    "• flash-lit glossy skin with subtle K-beauty glow",
    "• pastel gradient background (milk pink, baby blue, lilac) with haze",
    "• sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
    "• tiny glitter bokeh and lens glints",
    "• clean studio sweep look; light falloff; subtle film grain",
    "• original influencer look — not a specific or real celebrity face"
  ].join(" ");
}

/* ---------------- API: Full Pipeline ---------------- */
app.get("/api/trend", async (req, res) => {
  try {
    const style = req.query.style || "female";

    // 1. Song
    const pick = pickSongAlgorithm();

    // 2. Description
    const description = await makeFirstPersonDescription(pick.title, pick.artist);

    // 3. Image (fixed: no response_format)
    let imageUrl = null;
    try {
      const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender);
      const out = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        size: "1024x1024"
      });
      const d = out?.data?.[0];
      if (d?.b64_json) imageUrl = `data:image/png;base64,${d.b64_json}`;
      else if (d?.url) imageUrl = d.url;
    } catch (e) {
      console.error("❌ Image gen failed:", e.message);
      imageUrl = "https://placehold.co/600x600?text=No+Image";
    }

    // 4. Voice
    let voiceBase64 = null;
    try {
      const audioBuffer = await googleTTS(description, style);
      if (audioBuffer) voiceBase64 = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    } catch (e) {
      console.error("❌ Voice gen failed:", e.message);
    }

    // 5. Return JSON
    res.json({
      title: pick.title,
      artist: pick.artist,
      gender: pick.gender,
      description,
      hashtags: ["#NowPlaying", "#AIFavorite"],
      image: imageUrl,
      voice: voiceBase64,
      refresh: 3000
    });
  } catch (e) {
    console.error("❌ Trend pipeline failed:", e);
    res.status(500).json({ error: "Pipeline failed" });
  }
});

/* ---------------- Health ---------------- */
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323drop live backend on :${PORT}`));
