// server.js — 323drop Live (Persona Song Choose Algorithm + Continuous Pre-gen + 70+ word descriptions)
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

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Gen-Z fans style system ---------------- */
const STYLE_PRESETS = {
  "stan-photocard": {
    description: "lockscreen-ready idol photocard vibe for Gen-Z fan culture",
    tags: [
      "square 1:1 cover, subject centered, shoulders-up or half-body",
      "flash-lit glossy skin with subtle K-beauty glow",
      "pastel gradient background (milk pink, baby blue, lilac) with haze",
      "sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
      "tiny glitter bokeh and lens glints",
      "clean studio sweep look; light falloff; subtle film grain",
      "original influencer look — not a specific or real celebrity face"
    ]
  }
};
const DEFAULT_STYLE = process.env.DEFAULT_STYLE || "stan-photocard";

/* ---------------- First-person description helper (70+ words) ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. The melody sticks in my head like glue, and I can feel the energy pulsing through every beat. The way the vocals flow on top of the rhythm makes the track feel like it was built for endless replays. It has this wild, unstoppable energy that makes me want to move, share it with friends, and relive the moment again and again until it becomes the anthem of my week.`,
    `When “${title}” comes on, I can’t help but stop scrolling and let it run, because ${artist} really caught a wave with this one. There’s something addictive about the rhythm, the way it shifts between intensity and flow, keeping me locked in every second. It feels like the perfect mix of confidence and emotion, striking that balance between boldness and vulnerability. The more I listen, the more I realize it’s one of those tracks that feels personal, yet universal, and it sticks in my head like a soundtrack I didn’t know I needed.`,
    `I’ve had “${title}” by ${artist} stuck in my head all day, and it’s not leaving anytime soon. The vocals wrap around me like a conversation with a close friend, pulling me deeper with every line, while the beat feels alive, almost breathing. Every time the chorus hits, I get goosebumps, like I’m standing in the middle of a crowd shouting it back word for word. It’s one of those rare tracks that takes over the room and changes the atmosphere completely, leaving me wanting to hit repeat no matter what I’m doing.`,
    `Listening to “${title}” makes me feel like I’m in on the trend before it blows up, and that’s the exact magic ${artist} nailed here. The sound is sharp, bold, and fearless, but underneath it all there’s this softness that makes it feel deeply personal. It’s the kind of song that hits like a wave — powerful, quick, and unforgettable — but also lingers long after it ends. I can see it becoming a viral anthem, the kind of track that lives in everyone’s feed, yet still feels like it was made just for me.`,
    `Every time I hear “${title}” by ${artist}, I get that rush that only a viral track can bring, where the energy instantly changes the entire space around me. The production is electric, the kind of sound that fills a room and makes it brighter, louder, and impossible to ignore. It feels less like just a song and more like a cultural moment, a movement that I want to carry with me everywhere I go. With each replay, the vibe only grows stronger, embedding itself deeper, and I can’t imagine my playlist without it now.`
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------------- Helpers ---------------- */
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
function cleanForPrompt(str = "") {
  return str.replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "").trim();
}

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

/* ---------------- Merge lists ---------------- */
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

/* ---------------- Persona-based song pick ---------------- */
async function nextNewestPick() {
  try {
    const persona = randomPersona();
    const songs = await fetchAllSongs();
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
From the following trending songs, pick ONE that best matches your vibe.
Reply ONLY as JSON { "title": "...", "artist": "..." }.

List:
${listText}`
        }
      ]
    });

    let pick;
    try {
      pick = JSON.parse(completion.choices[0].message.content);
    } catch {
      pick = songs[Math.floor(Math.random() * songs.length)];
    }

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      description: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying", "#AIFavorite"]
    };
  } catch (e) {
    console.error("song pick failed:", e.message);
    return {
      title: "Fallback Song",
      artist: "AI DJ",
      description: "I just played this fallback track and it's still a vibe.",
      hashtags: ["#AI"]
    };
  }
}

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    "The performer should appear as a young " + genderFromArtist(artist) + " Korean idol (Gen-Z style).",
    ...s.tags.map(t => `• ${t}`)
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
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
      lastImgErr = { model, message: e?.message || String(e) };
    }
  }
  return null;
}

/* ---------------- Continuous pre-gen ---------------- */
async function generateNextPick() {
  if (generatingNext) return;
  generatingNext = true;
  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;
    nextPickCache = {
      title: pick.title,
      artist: pick.artist,
      description: pick.description,
      hashtags: pick.hashtags,
      image: imageUrl,
      count: imageCount
    };
  } finally {
    generatingNext = false;
  }
}

/* ---------------- JSON one-shot with continuous pre-gen ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    let result;
    if (nextPickCache) {
      result = nextPickCache;
      nextPickCache = null;
      generateNextPick(); // always prepare next one
    } else {
      const pick = await nextNewestPick();
      const prompt = stylizedPrompt(pick.title, pick.artist);
      const imageUrl = await generateImageUrl(prompt);
      if (imageUrl) imageCount += 1;
      result = {
        title: pick.title,
        artist: pick.artist,
        description: pick.description,
        hashtags: pick.hashtags,
        image: imageUrl,
        count: imageCount
      };
      generateNextPick(); // always prepare next one
    }
    res.json(result);
  } catch {
    res.json({ title: "Fresh Drop", artist: "323KbabeAI", description: "Text-only.", hashtags: ["#music","#trend"], image: null, count: imageCount });
  }
});

/* ---------------- SSE stream with continuous pre-gen ---------------- */
app.get("/api/trend-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15015);

  send("hello", { ok: true });

  try {
    let pick;
    if (nextPickCache) {
      pick = nextPickCache;
      nextPickCache = null;
      generateNextPick(); // always prepare next one
    } else {
      pick = await nextNewestPick();
      const prompt = stylizedPrompt(pick.title, pick.artist);
      pick.image = await generateImageUrl(prompt);
      if (pick.image)
