// server.js — multi-source persona song picker with locked image style
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

/* ---------------- CORS ---------------- */
app.use(cors({ origin: "*", methods: ["GET"] }));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
  // dedupe by title+artist
  const seen = new Set();
  return all.filter(song => {
    const key = `${song.title}-${song.artist}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ---------------- GPT Selection ---------------- */
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

/* ---------------- GPT Description ---------------- */
async function makePersonaDescription(persona, title, artist) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "you are a gen-z music stan account." },
      {
        role: "user",
        content: `As ${persona}, write a minimum 70-word stan-style rant with lots of emojis about the song “${title}” by ${artist}.`
      }
    ]
  });
  return completion.choices[0].message.content || "";
}

/* ---------------- Image Generation (locked style: stan-photocard) ---------------- */
async function generateImage(title, artist) {
  const prompt = [
    `create a high-impact cover image for the song "${title}" by ${artist}.`,
    "audience: gen-z fan culture (fans). visual goal: stan-photocard idol photocard vibe.",
    "make an original pop-idol-adjacent face and styling; do not replicate any real person or celebrity.",
    "absolutely no text, letters, numbers, logos, or watermarks.",
    "square 1:1 composition, glossy k-pop look, pastel gradient background, subtle film grain."
  ].join(" ");

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
    const description = await makePersonaDescription(persona, pick.title, pick.artist);
    const image = await generateImage(pick.title, pick.artist);

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
      persona: "neutral ai persona",
      description: "this is a fallback track when things break.",
      hashtags: ["#ai"],
      image: null
    });
  }
});

/* ---------------- Health ---------------- */
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`multi-source persona song picker live on :${PORT}`);
});
