// male.js — 323drop Live (Male-Only Mode, Full Top 50)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const textToSpeech = require("@google-cloud/text-to-speech");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) =>
    !origin || ALLOW.includes(origin)
      ? cb(null, true)
      : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Google TTS ---------------- */
const googleTTSClient = new textToSpeech.TextToSpeechClient();

// ✅ Always male voice (Gen-Z style)
function pickMaleVoice() {
  return { languageCode: "en-US", name: "en-US-Neural2-D", ssmlGender: "MALE" };
}

async function googleTTS(text) {
  try {
    const [response] = await googleTTSClient.synthesizeSpeech({
      input: { text },
      voice: pickMaleVoice(),
      audioConfig: { audioEncoding: "MP3" }
    });
    if (!response.audioContent) return null;
    console.log("✅ Google TTS audio length:", response.audioContent.length, "voice: male");
    return Buffer.from(response.audioContent, "binary");
  } catch (e) {
    console.error("❌ Google TTS error:", e.message);
    return null;
  }
}

/* ---------------- OpenAI fallback TTS ---------------- */
async function openaiTTS(text) {
  try {
    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "verse", // ✅ male fallback
      input: text,
    });
    console.log("✅ OpenAI TTS generated male audio");
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

/* ---------------- Spotify Top 50 (Sept 2025) ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast" },
  { title: "Your Idol", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast" },
  { title: "Soda Pop", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast" },
  { title: "How It’s Done", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast" },
  { title: "DAISIES", artist: "Justin Bieber" },
  { title: "Ordinary", artist: "Alex Warren" },
  { title: "What It Sounds Like", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast" },
  { title: "Takedown", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast" },
  { title: "Love Me Not", artist: "Ravyn Lenae" },
  { title: "Free", artist: "Rumi, Jinu, EJAE, Andrew Choi, KPop Demon Hunters Cast" },
  { title: "Dreams (2004 Remaster)", artist: "Fleetwood Mac" },
  { title: "What I Want (feat. Tate McRae)", artist: "Morgan Wallen, Tate McRae" },
  { title: "undressed", artist: "sombr" },
  { title: "Manchild", artist: "Sabrina Carpenter" },
  { title: "I Got Better", artist: "Morgan Wallen" },
  { title: "Just In Case", artist: "Morgan Wallen" },
  { title: "No One Noticed", artist: "The Marías" },
  { title: "BIRDS OF A FEATHER", artist: "Billie Eilish" },
  { title: "Last Time I Saw You", artist: "Nicki Minaj" },
  { title: "Need You Now", artist: "Lady Antebellum" },
  { title: "One of the Girls", artist: "The Weeknd, JENNIE, Lily-Rose Depp" },
  { title: "Paint The Town Red", artist: "Doja Cat" },
  { title: "Lose Yourself", artist: "Eminem" },
  { title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars" },
  { title: "Luther", artist: "Kendrick Lamar & SZA" },
  { title: "Ordinary (Acoustic)", artist: "Alex Warren" },
  { title: "TEXAS HOLD 'EM", artist: "Beyoncé" },
  { title: "Houdini", artist: "Dua Lipa" },
  { title: "Espresso", artist: "Sabrina Carpenter" },
  { title: "Snow On The Beach", artist: "Taylor Swift, Lana Del Rey" },
  { title: "Gently", artist: "Drake feat. Bad Bunny" },
  { title: "Cruel Summer", artist: "Taylor Swift" },
  { title: "I Like The Way You Kiss Me", artist: "Artemas" },
  { title: "Seven (feat. Latto)", artist: "Jung Kook, Latto" },
  { title: "IDGAF", artist: "Drake" },
  { title: "Too Sweet", artist: "Hozier" },
  { title: "Slime You Out", artist: "Drake feat. SZA" },
  { title: "Barbie World", artist: "Nicki Minaj, Ice Spice, Aqua" },
  { title: "Peaches", artist: "Justin Bieber feat. Daniel Caesar & Giveon" },
  { title: "Up", artist: "Cardi B" },
  { title: "MONTERO (Call Me By Your Name)", artist: "Lil Nas X" },
  { title: "drivers license", artist: "Olivia Rodrigo" },
  { title: "Shivers", artist: "Ed Sheeran" },
  { title: "Blinding Lights", artist: "The Weeknd" },
  { title: "As It Was", artist: "Harry Styles" },
  { title: "Flowers", artist: "Miley Cyrus" },
  { title: "Levitating", artist: "Dua Lipa" }
];

/* ---------------- Helpers ---------------- */
async function makeFirstPersonDescription(title, artist) {
  try {
    console.log("📝 Generating description for:", title, "by", artist);
    const prompt = `
      Write a minimum 70-word first-person description of the song "${title}" by ${artist}.
      Mimic the artist’s mood and style. Make it sound natural, Gen-Z relatable, and as if the artist themselves is talking.
      Add a slightly different perspective or vibe each time so no two outputs are identical.
      Current time: ${new Date().toISOString()}.
    `;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", temperature: 0.9,
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
  return TOP50_USA[idx];
}

// ✅ Always male image
function stylizedPrompt() {
  return [
    "Create a high-impact, shareable cover image.",
    "Audience: Gen-Z fan culture. Visual goal: lockscreen-ready idol photocard vibe.",
    "Make an ORIGINAL idol-like face and styling; do NOT replicate real celebrities.",
    "No text, logos, or watermarks.",
    "Square 1:1 composition.",
    "The performer should appear as a young male Korean idol (Gen-Z style).",
    "• pastel gradient background (milk pink, baby blue, lilac)",
    "• glitter bokeh and lens glints",
    "• flash-lit glossy skin with subtle K-beauty glow",
    "• sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
    "• clean studio sweep look; subtle film grain"
  ].join(" ");
}

async function generateImageUrl() {
  try {
    console.log("🎨 Generating male idol image");
    const out = await openai.images.generate({
      model: "gpt-image-1", prompt: stylizedPrompt(), size: "1024x1024"
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
async function generateNextPick() {
  if (generatingNext) return;
  generatingNext = true;
  try {
    const pick = pickSongAlgorithm();
    const description = await makeFirstPersonDescription(pick.title, pick.artist);

    const imageUrl = await generateImageUrl();

    let audioBuffer = await googleTTS(description);
    if (!audioBuffer) audioBuffer = await openaiTTS(description);

    let voiceBase64 = null;
    if (audioBuffer) {
      console.log("✅ Male voice generated (bytes:", audioBuffer.length, ")");
      voiceBase64 = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    }

    nextPickCache = {
      title: pick.title,
      artist: pick.artist,
      gender: "male",
      description,
      hashtags: ["#NowPlaying", "#AIFavorite"],
      image: imageUrl,
      voice: voiceBase64,
      refresh: voiceBase64 ? 3000 : null
    };
  } finally { generatingNext = false; }
}

/* ---------------- API Routes ---------------- */
app.get("/api/trend", async (req, res) => {
  try {
    if (!nextPickCache) {
      console.log("⏳ First drop generating…");
      await generateNextPick();
    }

    const result = nextPickCache || {
      title: "Loading Song",
      artist: "System",
      gender: "male",
      description: "AI is warming up… please wait.",
      hashtags: ["#NowPlaying"],
      image: "https://placehold.co/600x600?text=Loading",
      voice: null,
      refresh: 5000
    };

    nextPickCache = null;
    generateNextPick(); // pre-gen next in background

    res.json(result);
  } catch (e) {
    console.error("❌ Trend API error:", e);
    res.json({
      title: "Error Song", artist: "System", gender: "male",
      description: "Something went wrong. Retrying soon…",
      hashtags: ["#Error"],
      image: "https://placehold.co/600x600?text=Error",
      voice: null, refresh: 5000
    });
  }
});

app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    if (!text) return res.status(400).json({ error: "Missing text" });

    let audioBuffer = await googleTTS(text);
    if (!audioBuffer) audioBuffer = await openaiTTS(text);
    if (!audioBuffer) return res.status(500).json({ error: "No audio generated" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) { res.status(500).json({ error: "Voice TTS failed" }); }
});

app.get("/api/test-google", async (req, res) => {
  try {
    const text = "Google TTS is working. Hello from 323drop male mode!";
    let audioBuffer = await googleTTS(text);
    if (!audioBuffer) audioBuffer = await openaiTTS(text);
    if (!audioBuffer) return res.status(500).json({ error: "No audio generated" });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) { res.status(500).json({ error: "Test TTS failed" }); }
});

app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`323drop live backend (male-only, full Top 50) on :${PORT}`);
  await generateNextPick(); // ✅ Pre-warm first drop
});
