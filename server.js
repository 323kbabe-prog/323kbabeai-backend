// server.js — multi-source persona song picker with locked image style
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(
  cors({
    origin: (origin, cb) =>
      !origin || ALLOW.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS: origin not allowed")),
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

/* ---------------- OpenAI ---------------- */
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY");
  process.exit(1);
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------------- Personas ---------------- */
const personas = [
  "17-year-old black male hip-hop fan in atlanta",
  "22-year-old korean female k-pop stan in seoul",
  "30-year-old latino reggaeton fan in los angeles",
  "40-year-old white indie-rock dad in chicago",
  "19-year-old indian edm raver in mumbai",
  "25-year-old japanese anime-pop fan in tokyo",
  "28-year-old african female afrobeats lover in lagos"
];
function randomPersona() {
  return personas[Math.floor(Math.random() * personas.length)];
}

/* ---------------- Mock trending fetchers (replace with real APIs later) ---------------- */
async function fetchSpotifyTop() {
  return [
    { title: "Paint The Town Red", artist: "Doja Cat" },
    { title: "Feather", artist: "Sabrina Carpenter" }
  ];
}
async function fetchAppleTop() {
  return [
    { title: "Water", artist: "Tyla" },
    { title: "Good Luck, Babe!", artist: "Chappell Roan" }
  ];
}
async function fetchYouTubeTop() {
  return [
    { title: "Espresso", artist: "Sabrina Carpenter" },
    { title: "Lose Control", artist: "Teddy Swims" }
  ];
}
async function fetchTikTokViral() {
  return [
    { title: "Not Like Us", artist: "Kendrick Lamar" },
    { title: "Please Please Please", artist: "Sabrina Carpenter" }
  ];
}
async function fetchGoogleTrends() {
  return [
    { title: "Gata Only", artist: "FloyyMenor ft. Cris MJ" },
    { title: "Desire", artist: "Calvin Harris & Sam Smith" }
  ];
}

/* ---------------- Merge trending lists ---------------- */
async function fetchAllSongs() {
  const all = [
    ...(await fetchSpotifyTop()),
    ...(await fetchAppleTop()),
    ...(await fetchYouTubeTop()),
    ...(await fetchTikTokViral()),
    ...(await fetchGoogleTrends())
  ];
  const seen = new Set();
  return all.filter(song => {
    const key = `${song.title}-${song.artist}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---------------- GPT Song Selection ---------------- */
async function pickSongWithPersona(persona, songs) {
  const listText = songs
    .map((s, i) => `${i + 1}. ${s.title} – ${s.artist}`)
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "you are a music trend selector." },
      {
        role: "user",
        content: `You are acting as ${persona}.
From the following list of trending songs, pick ONE that best matches your vibe. 
Reply ONLY as JSON { "title": "...", "artist": "..." }.

List:
${listText}`
      }
    ]
  });

  let pick = {};
  try {
    pick = JSON.parse(completion.choices[0].message.content);
  } catch {
    pick = songs[Math.floor(Math.random() * songs.length)];
  }
  return pick;
}

/* ---------------- Description Helper ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `i just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal...`,
    `when “${title}” comes on, i can’t help but stop scrolling and let it run...`,
    `i’ve had “${title}” by ${artist} stuck in my head all day, and it’s not leaving anytime soon...`,
    `listening to “${title}” makes me feel like i’m in on the trend before it blows up...`,
    `every time i hear “${title}” by ${artist}, i get that rush that only a viral track can bring...`
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------------- Image Generation (locked style) ---------------- */
function stylizedPrompt(title, artist) {
  return [
    `create a high-impact cover image for the song "${title}" by ${artist}.`,
    "audience: gen-z fan culture (fans). visual goal: stan-photocard idol photocard vibe.",
    "make an original pop-idol-adjacent face and styling; do not replicate any real person or celebrity.",
    "absolutely no text, letters, numbers, logos, or watermarks.",
    "square 1:1 composition, glossy k-pop look, pastel gradient background, subtle film grain."
  ].join(" ");
}

async function generateImageUrl(prompt) {
  try {
    const out = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json"
    });
    const d = out?.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url;
  } catch (e) {
    console.error("[image error]", e.message);
  }
  return null;
}

/* ---------------- API Endpoint ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const persona = randomPersona();
    const songs = await fetchAllSongs();
    const pick = await pickSongWithPersona(persona, songs);
    const description = makeFirstPersonDescription(pick.title, pick.artist);
    const image = await generateImageUrl(stylizedPrompt(pick.title, pick.artist));

    res.json({
      title: pick.title,
      artist: pick.artist,
      persona,
      description,
      hashtags: ["#nowplaying", "#fyp", "#stanvibes"],
      image
    });
  } catch (e) {
    console.error("trend error", e);
    res.json({
      title: "fallback song",
      artist: "ai dj",
      persona: "neutral",
      description: "this is a fallback track when things break.",
      hashtags: ["#ai"],
      image: null
    });
  }
});

/* ---------------- Voice (TTS) ---------------- */
app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    if (!text) return res.status(400).json({ error: "missing text" });
    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
    });
    const buffer = Buffer.from(await out.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch {
    res.status(500).json({ error: "tts failed" });
  }
});

/* ---------------- Health ---------------- */
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get("/", (_req, res) => res.json({ ok: true }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ multi-source song picker live on :${PORT}`);
});
