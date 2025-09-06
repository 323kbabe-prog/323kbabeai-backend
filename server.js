// server.js — 323drop Live (Spotify Top 50 USA + Gender + Algorithm + Google TTS default + OpenAI optional)
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
async function googleTTS(text) {
  const [response] = await googleTTSClient.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: "en-US",
      name: "en-US-Neural2-F", // sweet female neural voice
      ssmlGender: "FEMALE"
    },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 1.0,
      pitch: 2.0
    }
  });
  return response.audioContent;
}

/* ---------------- State ---------------- */
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Spotify Top 50 USA (Sept 2025, with gender) ---------------- */
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
function makeFirstPersonDescription(title, artist) {
  return `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal.`;
}
function pickSongAlgorithm() {
  const weightTop = 0.7;
  const pool = Math.random() < weightTop ? TOP50_USA.slice(0, 20) : TOP50_USA.slice(20);
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
  } finally {
    generatingNext = false;
  }
}

/* ---------------- API Routes ---------------- */
app.get("/api/trend", async (_req, res) => {
  let result;
  if (nextPickCache) {
    result = nextPickCache;
    nextPickCache = null;
    generateNextPick();
  } else {
    result = await nextNewestPick();
    generateNextPick();
  }
  res.json(result);
});

app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    const source = req.query.source || "google"; // default = google
    const gender = req.query.gender || "neutral";
    if (!text) return res.status(400).json({ error: "Missing text" });

    let audioBuffer;

    if (source === "openai") {
      // use OpenAI only if requested
      const out = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: chooseVoiceByGender(gender),
        input: text
      });
      audioBuffer = Buffer.from(await out.arrayBuffer());
    } else {
      // default: Google TTS
      audioBuffer = await googleTTS(text);
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (e) {
    console.error("TTS failed", e);
    res.status(500).json({ error: "TTS failed" });
  }
});

app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
  generateNextPick();
});
