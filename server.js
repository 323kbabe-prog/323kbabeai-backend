// server.js — 323drop Final Backend (Spotify Top 50 + Audience Race + Mood Personality, DALL·E-only image)
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
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

/* ---------------- Helpers ---------------- */
function cleanForPrompt(str = "") {
  return str.replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "").trim();
}

function genderFromArtist(artist = "") {
  const lower = artist.toLowerCase();
  if (["ariana","sabrina","doja","rihanna","beyonce","taylor"].some(n => lower.includes(n))) return "female";
  if (["bieber","tyler","kendrick","eminem","drake"].some(n => lower.includes(n))) return "male";
  return "neutral";
}

function chooseVoice(artist = "") {
  const lower = artist.toLowerCase();
  if (["ariana","sabrina","doja","rihanna","taylor"].some(n => lower.includes(n))) return "shimmer";
  if (["bieber","tyler","kendrick","eminem","drake"].some(n => lower.includes(n))) return "verse";
  return "alloy";
}

function hashtagsForSong(title, artist) {
  return [
    `#${artist.replace(/\s+/g,"")}`,
    `#${title.replace(/\s+/g,"")}`,
    "#music", "#trend", "#nowplaying"
  ];
}

/* ---------------- Spotify Top 50 Picker ---------------- */
async function pickFromSpotify() {
  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(
          process.env.SPOTIFY_CLIENT_ID + ":" + process.env.SPOTIFY_CLIENT_SECRET
        ).toString("base64")
      },
      body: "grant_type=client_credentials"
    });
    const { access_token } = await tokenRes.json();

    const r = await fetch("https://api.spotify.com/v1/playlists/37i9dQZEVXbMDoHDwVN2tF/tracks", {
      headers: { "Authorization": `Bearer ${access_token}` }
    });
    const j = await r.json();
    const tracks = j.items.map(i => ({
      title: i.track.name,
      artist: i.track.artists.map(a => a.name).join(", ")
    }));
    return tracks[Math.floor(Math.random() * tracks.length)];
  } catch (e) {
    console.error("Spotify pick failed:", e.message);
    return { title: "Unknown", artist: "Unknown" };
  }
}

/* ---------------- Description Generator ---------------- */
const AUDIENCE_RACES = [
  "Black Gen-Z fan from LA",
  "Korean K-pop fan",
  "Latina TikTok creator",
  "White college indie fan",
  "Indian hip-hop dancer"
];
const MOODS = ["hyped", "nostalgic", "emo", "vibey", "confident"];

async function generateDescription(title, artist) {
  const persona = AUDIENCE_RACES[Math.floor(Math.random() * AUDIENCE_RACES.length)];
  const mood = MOODS[Math.floor(Math.random() * MOODS.length)];
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: `Act as a ${persona} with a ${mood} personality. Write a first-person description (50+ words) reacting to the song.` },
      { role: "user", content: `${title} by ${artist}` }
    ]
  });
  return completion.choices[0].message.content;
}

/* ---------------- Image Generation (DALL·E only) ---------------- */
async function generateImageUrl(prompt) {
  try {
    const out = await openai.images.generate({
      model: "dall-e-3",
      prompt,
      size: "1024x1024"
    });
    const d = out?.data?.[0];
    return d?.url || null;
  } catch (e) {
    console.error("[images]", e.message);
    return null;
  }
}

function stylizedPrompt(title, artist) {
  return [
    `Create a high-impact, shareable cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    "The performer should appear as a young " + genderFromArtist(artist) + " Korean idol (Gen-Z style).",
    "Absolutely no text, logos, or watermarks.",
    "Square 1:1 composition, glossy aesthetic, fan-culture ready."
  ].join(" ");
}

/* ---------------- API Endpoints ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const pick = await pickFromSpotify();
    const desc = await generateDescription(pick.title, pick.artist);
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    res.json({
      title: pick.title,
      artist: pick.artist,
      description: desc,
      hashtags: hashtagsForSong(pick.title, pick.artist),
      image: imageUrl
    });
  } catch (e) {
    res.json({ title: "Error", artist: "AI DJ", description: "Failed to fetch trend.", hashtags: ["#ai"], image: null });
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

app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop backend running on :${PORT}`);
});
