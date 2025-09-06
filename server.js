// server.js — 323drop Live (AI Favorite Pick + Always Korean Idol + Prefetch Next Image + Gen-Z Voice)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

const app = express(); // must be defined before routes

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

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let nextCachedTrend = null; // prefetch cache

/* ---------------- First-person description helper (50+ words) ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. The melody sticks in my head like glue, and I can feel the energy pulsing through every beat. It makes me want to get up, move, and share it with everyone I know, because it really feels like a soundtrack to this exact moment in time.`,
    `When “${title}” comes on, I can’t help but stop scrolling and let it run. ${artist} really caught a wave with this one. There’s something addictive about the rhythm, the way it shifts between intensity and flow. It feels like a perfect mix of confidence and emotion, and I swear I could loop it all day and not get tired.`,
    `I’ve had “${title}” by ${artist} stuck in my head all day, and it’s not leaving anytime soon. The vocals wrap around me like a conversation with a close friend, and the beat feels alive. Every time the chorus hits, I get goosebumps, like I’m standing in the middle of a crowd singing it back word for word.`,
    `Listening to “${title}” makes me feel like I’m in on the trend before it blows up. ${artist} nailed the energy here. The sound is sharp, bold, and fearless, but it also has this soft undercurrent that makes it so personal. I love that it feels both viral and intimate at the same time, like it’s written for the world but also just for me.`,
    `Every time I hear “${title}” by ${artist}, I get that rush that only a viral track can bring. It’s wild how a song can instantly change the atmosphere of a room, making it brighter and louder. This one feels like a moment — not just music, but a movement that I want to carry with me everywhere and keep on repeat.`
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------------- Voice helpers ---------------- */
function chooseVoice(artist = "") {
  const lower = artist.toLowerCase();
  // Female Gen-Z vibe
  if (["ariana","sabrina","doja","rihanna","taylor","olivia","icespice"].some(n => lower.includes(n))) {
    return "shimmer"; // young, bright female
  }
  // Male Gen-Z vibe
  if (["bieber","tyler","kendrick","eminem","drake","jack"].some(n => lower.includes(n))) {
    return "verse";   // young, casual male
  }
  // Default fallback: shimmer (to always sound younger)
  return "shimmer";
}

/* ---------------- Trend picker ---------------- */
async function nextNewestPick() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a music trend parser." },
        { role: "user", content: "Pick ONE current trending song (Spotify or TikTok). Reply ONLY as JSON { \"title\": \"...\", \"artist\": \"...\" }." }
      ]
    });

    const text = completion.choices[0].message.content || "{}";
    let pick;
    try {
      pick = JSON.parse(text);
    } catch {
      pick = { title: "Unknown", artist: "Unknown" };
    }

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      desc: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying", "#AIFavorite"]
    };
  } catch {
    return { title: "Fallback Song", artist: "AI DJ", desc: "I just played this fallback track and it's still a vibe.", hashtags: ["#AI"] };
  }
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  try {
    const out = await openai.images.generate({
      model: "gpt-image-1", // faster
      prompt,
      size: "512x512",      // smaller, faster
      response_format: "b64_json"
    });
    const d = out?.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    return d?.url || null;
  } catch (e) {
    lastImgErr = { message: e.message };
    return null;
  }
}

/* ---------------- Trend + Prefetch helper ---------------- */
async function generateTrendAndImage() {
  const pick = await nextNewestPick();
  const prompt = `Cover art for ${pick.title} by ${pick.artist}, Korean Gen-Z idol style.`;
  const imageUrl = await generateImageUrl(prompt);
  if (imageUrl) imageCount += 1;
  return {
    title: pick.title,
    artist: pick.artist,
    description: pick.desc,
    hashtags: pick.hashtags,
    image: imageUrl,
    count: imageCount
  };
}

/* ---------------- Routes ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    if (nextCachedTrend) {
      const out = nextCachedTrend;
      nextCachedTrend = null;
      res.json(out);
      generateTrendAndImage().then(r => { nextCachedTrend = r; });
      return;
    }
    const out = await generateTrendAndImage();
    res.json(out);
    generateTrendAndImage().then(r => { nextCachedTrend = r; });
  } catch {
    res.json({ title: "Fresh Drop", artist: "323KbabeAI", description: "Text-only.", hashtags: ["#music","#trend"], image: null, count: imageCount });
  }
});

app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    if (!text) return res.status(400).json({ error: "Missing text" });
    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: chooseVoice(req.query.artist || ""),
      input: text,
    });
    const buffer = Buffer.from(await out.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: "TTS failed" });
  }
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
});
