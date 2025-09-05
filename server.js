// server.js — 323drop Live with Voice (AI Favorite Pick + TTS)
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

const app = express();

const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

let imageCount = 0;
let lastSong = null;

/* ----------- First-person description helper ----------- */
function makeFirstPersonDescription(title, artist) {
  return `I just played “${title}” by ${artist} and the vibe is unreal. The melody sticks in my head like glue, and I can feel the energy pulsing through every beat. It makes me want to move and share it with everyone, because it really feels like a soundtrack to this exact moment.`;
}

/* ----------- Song picker (avoid last one) ----------- */
async function nextNewestPick() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 1.1,
      messages: [
        { role: "system", content: "You are a music trend parser." },
        {
          role: "user",
          content: lastSong
            ? `Pick ONE current trending song (Spotify or TikTok). It must be DIFFERENT from "${lastSong.title}" by ${lastSong.artist}. Reply ONLY as JSON { "title": "...", "artist": "..." }.`
            : `Pick ONE current trending song (Spotify or TikTok). Reply ONLY as JSON { "title": "...", "artist": "..." }.`
        }
      ]
    });
    const text = completion.choices[0].message.content || "{}";
    let pick = JSON.parse(text);
    lastSong = { title: pick.title, artist: pick.artist };
    return {
      title: pick.title,
      artist: pick.artist,
      desc: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying", "#AIFavorite"]
    };
  } catch (e) {
    return { title: "Fallback Song", artist: "AI DJ", desc: "Fallback vibe.", hashtags: ["#AI"] };
  }
}

/* ----------- Generate voice with TTS ----------- */
async function generateVoice(desc) {
  try {
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: desc
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
  } catch (e) {
    console.error("TTS error:", e.message);
    return null;
  }
}

/* ----------- API endpoint ----------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const pick = await nextNewestPick();
    const voiceUrl = await generateVoice(pick.desc);
    res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc,
      hashtags: pick.hashtags,
      image: null, // image disabled in this minimal demo
      voice: voiceUrl,
      count: ++imageCount
    });
  } catch {
    res.json({ title: "Error", artist: "None", description: "Text-only.", voice: null });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323drop with voice on :${PORT}`));
