// server.js — 323drop Live (Spotify Top 50 USA + Gender + Algorithm + TTS + Frontend no scrollbars)
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

/* ---------------- Style Presets ---------------- */
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

/* ---------------- Helpers ---------------- */
function makeFirstPersonDescription(title, artist) {
  return `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. The melody sticks in my head like glue, the vocals feel alive, and every replay makes it more addictive. It’s one of those tracks that changes the whole mood of the room.`;
}

function pickSongAlgorithm() {
  const weightTop = 0.7;
  const pool = Math.random() < weightTop ? TOP50_USA.slice(0, 20) : TOP50_USA.slice(20);
  const idx = Math.floor(Math.pow(Math.random(), 1.5) * pool.length);
  return pool[idx];
}

function stylizedPrompt(title, artist, gender, styleKey = DEFAULT_STYLE) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    `Audience: Gen-Z fan culture. Visual goal: ${s.description}.`,
    "Make an ORIGINAL idol-like face and styling; do NOT replicate real celebrities.",
    "No text, logos, or watermarks.",
    "Square 1:1 composition.",
    `The performer should appear as a young ${gender} Korean idol (Gen-Z style).`,
    ...s.tags.map(t => `• ${t}`)
  ].join(" ");
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
      if (url) return url;
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
    const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender);
    const imageUrl = await generateImageUrl(prompt);
    nextPickCache = { ...pick, image: imageUrl };
  } finally {
    generatingNext = false;
  }
}

/* ---------------- API Routes ---------------- */
app.get("/api/trend", async (_req, res) => {
  let result;
  if (nextPickCache) {
    result = nextPickCache; nextPickCache = null; generateNextPick();
  } else {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender);
    const imageUrl = await generateImageUrl(prompt);
    result = { ...pick, image: imageUrl };
    generateNextPick();
  }
  res.json(result);
});

app.get("/api/trend-stream", async (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15015);

  try {
    let pick;
    if (nextPickCache) { pick = nextPickCache; nextPickCache = null; generateNextPick(); }
    else { pick = await nextNewestPick(); const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender); pick.image = await generateImageUrl(prompt); generateNextPick(); }

    send("trend", pick);
    if (pick.image) { send("image", { src: pick.image }); send("status", { msg: "done" }); send("end", { ok:true }); }
    else { send("status", { msg: "image unavailable." }); send("end", { ok:false }); }
  } catch (e) {
    send("status", { msg: `error: ${e.message}` }); send("end", { ok:false });
  } finally {
    clearInterval(hb); res.end();
  }
});

app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "";
    const gender = req.query.gender || "neutral";
    if (!text) return res.status(400).json({ error: "Missing text" });

    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: chooseVoiceByGender(gender),
      input: text,
    });

    const buffer = Buffer.from(await out.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch {
    res.status(500).json({ error: "TTS failed" });
  }
});

app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Frontend with no scrollbars ---------------- */
app.get("/", (_req, res) => {
  res.send(`
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>323drop Live</title>
      <style>
        body, html { margin:0; padding:0; overflow:hidden; background:#000; color:#fff; font-family:sans-serif; }
        ::-webkit-scrollbar { display: none; }
        * { scrollbar-width: none; }
      </style>
    </head>
    <body>
      <div id="app">
        <h1>323drop is live…</h1>
        <p>No scrollbars here 🚀</p>
      </div>
      <script>
        document.addEventListener("DOMContentLoaded", () => {
          document.body.style.overflow = "hidden";
          document.documentElement.style.overflow = "hidden";
          const style = document.createElement("style");
          style.textContent = "::-webkit-scrollbar { display:none; } * { scrollbar-width:none; }";
          document.head.appendChild(style);
        });
      </script>
    </body>
    </html>
  `);
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(\`323drop live backend on :\${PORT}\`); generateNextPick(); });
