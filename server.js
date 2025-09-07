// server.js — 323drop Live (Spotify Top 50 + Pre-gen + OpenAI desc/images + Dual TTS + Cold-start fix)
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
    console.log("✅ OpenAI TTS generated audio");
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

/* ---------------- Spotify Top 50 (Sept 2025, with gender) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Your Idol", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast", gender: "male" },
  { title: "Soda Pop", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast", gender: "male" },
  { title: "How It’s Done", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "back to friends", artist: "sombr", gender: "male" },
  { title: "DAISIES", artist: "Justin Bieber", gender: "male" },
  { title: "Ordinary", artist: "Alex Warren", gender: "male" },
  { title: "What It Sounds Like", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Takedown", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Love Me Not", artist: "Ravyn Lenae", gender: "female" },
  { title: "Free", artist: "Rumi, Jinu, EJAE, Andrew Choi, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Dreams (2004 Remaster)", artist: "Fleetwood Mac", gender: "mixed" },
  { title: "What I Want (feat. Tate McRae)", artist: "Morgan Wallen, Tate McRae", gender: "mixed" },
  { title: "undressed", artist: "sombr", gender: "male" },
  { title: "Manchild", artist: "Sabrina Carpenter", gender: "female" },
  { title: "I Got Better", artist: "Morgan Wallen", gender: "male" },
  { title: "Just In Case", artist: "Morgan Wallen", gender: "male" },
  { title: "No One Noticed", artist: "The Marías", gender: "female" },
  { title: "BIRDS OF A FEATHER", artist: "Billie Eilish", gender: "female" },
  { title: "Last Time I Saw You", artist: "Nicki Minaj", gender: "female" },
  { title: "Need You Now", artist: "Lady Antebellum", gender: "mixed" },
  { title: "One of the Girls", artist: "The Weeknd, JENNIE, Lily-Rose Depp", gender: "mixed" },
  { title: "Paint The Town Red", artist: "Doja Cat", gender: "female" },
  { title: "Lose Yourself", artist: "Eminem", gender: "male" },
  { title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars", gender: "mixed" },
  { title: "Luther", artist: "Kendrick Lamar & SZA", gender: "mixed" },
  { title: "Ordinary (Acoustic)", artist: "Alex Warren", gender: "male" },
  { title: "TEXAS HOLD 'EM", artist: "Beyoncé", gender: "female" },
  { title: "Houdini", artist: "Dua Lipa", gender: "female" },
  { title: "Espresso", artist: "Sabrina Carpenter", gender: "female" },
  { title: "Snow On The Beach", artist: "Taylor Swift, Lana Del Rey", gender: "female" },
  { title: "Gently", artist: "Drake feat. Bad Bunny", gender: "male" },
  { title: "Cruel Summer", artist: "Taylor Swift", gender: "female" },
  { title: "I Like The Way You Kiss Me", artist: "Artemas", gender: "male" },
  { title: "Seven (feat. Latto)", artist: "Jung Kook, Latto", gender: "male" },
  { title: "IDGAF", artist: "Drake", gender: "male" },
  { title: "Too Sweet", artist: "Hozier", gender: "male" },
  { title: "Slime You Out", artist: "Drake feat. SZA", gender: "mixed" },
  { title: "Barbie World", artist: "Nicki Minaj, Ice Spice, Aqua", gender: "female" },
  { title: "Peaches", artist: "Justin Bieber feat. Daniel Caesar & Giveon", gender: "male" },
  { title: "Up", artist: "Cardi B", gender: "female" },
  { title: "MONTERO (Call Me By Your Name)", artist: "Lil Nas X", gender: "male" },
  { title: "drivers license", artist: "Olivia Rodrigo", gender: "female" },
  { title: "Shivers", artist: "Ed Sheeran", gender: "male" },
  { title: "Blinding Lights", artist: "The Weeknd", gender: "male" },
  { title: "As It Was", artist: "Harry Styles", gender: "male" },
  { title: "Flowers", artist: "Miley Cyrus", gender: "female" },
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

/* ---------------- Image Prompt (gender-only) ---------------- */
function stylizedPrompt(gender) {
  return [
    "Create a high-impact, shareable cover image.",
    "Audience: Gen-Z fan culture. Visual goal: lockscreen-ready idol photocard vibe.",
    "Make an ORIGINAL idol-like face and styling; do NOT replicate real celebrities.",
    "No text, logos, or watermarks.",
    "Square 1:1 composition.",
    `The performer should appear as a young ${gender} Korean idol (Gen-Z style).`,
    "• pastel gradient background (milk pink, baby blue, lilac)",
    "• glitter bokeh and lens glints",
    "• flash-lit glossy skin with subtle K-beauty glow",
    "• sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
    "• clean studio sweep look; subtle film grain"
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(gender) {
  try {
    console.log("🎨 Generating image for gender:", gender);
    const out = await openai.images.generate({
      model: "gpt-image-1",
      prompt: stylizedPrompt(gender),
      size: "1024x1024"
    });
    const d = out?.data?.[0];
    if (d?.b64_json) {
      console.log("🎨 Got image (base64).");
      return `data:image/png;base64,${d.b64_json}`;
    }
    if (d?.url) {
      console.log("🎨 Got image (url).");
      return d.url;
    }
    console.log("⚠️ Image generation returned empty.");
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
    const imageUrl = await generateImageUrl(pick.gender);

    // Voice (Google first, OpenAI fallback)
    let voiceBase64 = null;
    let audioBuffer = await googleTTS(description, style);
    if (!audioBuffer) audioBuffer = await openaiTTS(description, pick.gender);
    if (audioBuffer) {
      console.log("✅ Voice generated (bytes:", audioBuffer.length, ")");
      voiceBase64 = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    } else {
      console.log("⚠️ No voice generated for this drop.");
    }

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
    // ✅ Always wait if cache is empty (fix cold-start empty response)
    if (!nextPickCache) {
      await generateNextPick(req.query.style || "female");
    }
    const result = nextPickCache;
    nextPickCache = null;
    generateNextPick(req.query.style || "female"); // pre-gen next
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
