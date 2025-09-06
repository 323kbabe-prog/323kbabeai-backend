// songPicker.js — multi-source song picking algorithm with persona bias
// Node >= 20, CommonJS

const OpenAI = require("openai");

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
    // fallback: random song
    pick = songs[Math.floor(Math.random() * songs.length)];
  }
  return pick;
}

/* ---------------- Main exported function ---------------- */
async function getSongPick() {
  const persona = randomPersona();
  const songs = await fetchAllSongs();
  const pick = await pickSongWithPersona(persona, songs);
  return {
    title: pick.title,
    artist: pick.artist,
    persona
  };
}

module.exports = { getSongPick };
