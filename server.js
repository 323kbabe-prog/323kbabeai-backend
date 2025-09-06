// server.js — 323drop Live (Safe version: JSON guards + fallbacks + no repeats + young voice)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

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
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY env var.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let lastSongs = []; // track last 5 picks
let bannedSongs = ["Paint The Town Red"]; // avoid sticky repeats

/* ---------------- Helpers ---------------- */
function genderFromArtist(artist = "") {
  const lower = artist.toLowerCase();
  if (["ariana","sabrina","doja","rihanna","beyonce","taylor"].some(n => lower.includes(n))) return "female";
  if (["bieber","tyler","kendrick","eminem","drake"].some(n => lower.includes(n))) return "male";
  return "neutral";
}
function chooseVoice(artist = "") {
  const lower = artist.toLowerCase();
  if (["ariana","sabrina","doja","rihanna","taylor"].some(n => lower.includes(n))) return "shimmer"; // young female
  if (["bieber","tyler","kendrick","eminem","drake"].some(n => lower.includes(n))) return "verse";  // young male
  return "shimmer"; // default young
}
function cleanForPrompt(str = "") {
  return str.replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "").trim();
}

/* ---------------- AI Favorite Pick ---------------- */
async function nextNewestPick() {
  try {
    // Step 1: Ask GPT for trending song + metadata
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 1.0,
      messages: [
        { role: "system", content: "You are a music trend parser following TikTok, Spotify, and YouTube Shorts trends." },
        { 
          role: "user", 
          content: `Pick ONE real trending song that is viral right now. 
          Avoid repeats from recent picks: ${JSON.stringify(lastSongs)}. 
          Do not include banned songs: ${JSON.stringify(bannedSongs)}. 
          Reply ONLY as JSON { "title": "...", "artist": "...", "lens": "...", "genre": "...", "community": "..." }.
          Rules:
          - title = exact song name (real, not invented).
          - artist = real performer.
          - lens = short phrase (e.g. TikTok dance, remix, meme, duet).
          - genre = real musical style (e.g. K-pop, hip hop, EDM).
          - community = who is pushing it viral (e.g. Latino TikTok, Black hip hop fans, K-pop stans).
          Do not include "unknown", "omg", or filler. Only valid JSON.`
        }
      ]
    });

    let pick;
    try {
      const raw = completion.choices?.[0]?.message?.content?.trim();
      pick = raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.error("⚠️ JSON parse failed:", err.message);
      pick = null;
    }

    if (!pick || !pick.title) {
      pick = { 
        title: "Fresh Drop", 
        artist: "AI DJ", 
        lens: "viral energy", 
        genre: "mixed", 
        community: "global fans" 
      };
    }

    // Step 2: Generate description
    let descOut = "";
    try {
      const desc = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 1.0,
        messages: [
          { role: "system", content: "Write like a Gen-Z fan describing why a viral song is blowing up." },
          { 
            role: "user", 
            content: `Write a 60-80 word first-person description of "${pick.title}" by ${pick.artist}. 
            Lens: ${pick.lens}. 
            Genre: ${pick.genre}. 
            Community: ${pick.community}. 
            Keep it Gen-Z casual. No filler like "omg", "unknown", "idk".`
          }
        ]
      });
      descOut = desc.choices?.[0]?.message?.content?.trim() || "";
    } catch (err) {
      console.error("⚠️ Description failed:", err.message);
      descOut = "This track is buzzing everywhere right now.";
    }

    // Step 3: update history
    lastSongs.push({ title: pick.title, artist: pick.artist });
    if (lastSongs.length > 5) lastSongs.shift();

    return {
      title: pick.title,
      artist: pick.artist,
      lens: pick.lens,
      genre: pick.genre,
      community: pick.community,
      desc: descOut,
      hashtags: ["#NowPlaying", "#TrendingNow", "#AIFavorite"]
    };
  } catch (e) {
    console.error("❌ nextNewestPick error:", e.message);
    return {
      title: "Fallback Song",
      artist: "AI DJ",
      lens: "viral energy",
      genre: "mixed",
      community: "global fans",
      desc: "Couldn’t fetch the latest trend — but this track still sets the vibe.",
      hashtags: ["#AITrend"]
    };
  }
}

/* ---------------- Image generation + fallbacks ---------------- */
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await openai.images.generate({ model, prompt, size: "1024x1024", response_format: "b64_json" });
      const d = out?.data?.[0];
      const b64 = d?.b64_json;
      const url = d?.url;
      if (b64) return `data:image/png;base64,${b64}`;
      if (url)  return url;
    } catch (e) {
      lastImgErr = {
        model,
        status: e?.status || e?.response?.status || null,
        message: e?.response?.data?.error?.message || e?.message || String(e),
      };
      console.error("[images]", lastImgErr);
    }
  }
  return null;
}

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = "stan-photocard") {
  return `Create a high-impact, shareable cover image for "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}. 
Audience: Gen-Z fan culture. 
Make an ORIGINAL idol-like face. 
No text/logos. 
Square 1:1 composition.`;
}

/* ---------------- API Routes ---------------- */
app.get("/api/trend", async (_req, res) => {
  const pick = await nextNewestPick();
  const prompt = stylizedPrompt(pick.title, pick.artist);
  const imageUrl = await generateImageUrl(prompt);
  if (imageUrl) imageCount += 1;

  res.json({
    ...pick,
    image: imageUrl,
    count: imageCount
  });
});

app.get("/api/trend-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15000);

  send("hello", { ok: true });

  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    send("trend", pick);

    send("status", { msg: "generating image…" });
    const imageUrl = await generateImageUrl(prompt);
    if (lastImgErr) send("diag", lastImgErr);

    if (imageUrl) {
      imageCount += 1;
      send("count", { count: imageCount });
      send("image", { src: imageUrl });
      send("status", { msg: "done" });
    } else {
      send("status", { msg: "image unavailable." });
    }
  } catch (e) {
    send("status", { msg: `error: ${e.message}` });
  } finally {
    clearInterval(hb);
    send("end", { ok: true });
    res.end();
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
    console.error("[voice]", e.message);
    res.status(500).json({ error: "TTS failed" });
  }
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ 323drop live backend on :${PORT}`);
});
