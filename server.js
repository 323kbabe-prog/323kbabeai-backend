// server.js — 323drop Live (AI Favorite Pick + Faster Image Sync)
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

/* ---------------- Style presets ---------------- */
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
  return `I just played “${title}” by ${artist} — instant vibe. The beat feels alive and the chorus hits like a wave. It’s got that addictive loop energy, the kind of track you can’t escape once it starts. Viral but personal, like it’s written for everyone and for me. Pure Gen-Z soundtrack.`;
}

function genderFromArtist(artist = "") {
  const lower = artist.toLowerCase();
  if (["ariana","sabrina","doja","rihanna","taylor"].some(n => lower.includes(n))) return "female";
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
      title: pick.title,
      artist: pick.artist,
      desc: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying", "#TrendingNow", "#AIFavorite"]
    };
  } catch {
    return { title: "Fallback Song", artist: "AI DJ", desc: "Fallback track still a vibe.", hashtags: ["#AI"] };
  }
}

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    `Visual goal: ${s.description}.`,
    "Make an ORIGINAL idol-adjacent face; not a real celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, energetic but tasteful.",
    "The performer should appear as a young " + genderFromArtist(artist) + " Korean idol (Gen-Z style).",
    ...s.tags.map(t => `• ${t}`)
  ].join(" ");
}

/* ---------------- Image generation (fast) ---------------- */
async function generateImageUrl(prompt) {
  try {
    const out = await openai.images.generate({
      model: "gpt-image-1",   // ✅ fastest model only
      prompt,
      size: "512x512",        // ✅ faster than 1024
      response_format: "b64_json"
    });
    const d = out?.data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url;
  } catch (e) {
    lastImgErr = { message: e?.message || String(e) };
    console.error("[images]", lastImgErr);
  }
  return null;
}

/* ---------------- Routes ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);  // ✅ wait until done
    if (imageUrl) imageCount++;

    res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc,
      hashtags: pick.hashtags,
      image: imageUrl,        // ✅ always included now
      count: imageCount
    });
  } catch (e) {
    res.json({
      title: "Error",
      artist: "AI",
      description: e.message,
      hashtags: ["#music","#trend"],
      image: null,
      count: imageCount
    });
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
  } catch {
    res.status(500).json({ error: "TTS failed" });
  }
});

app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/api/stats", (_req,res) => res.json({ count: imageCount }));
app.get("/health", (_req,res) => res.json({ ok:true, time:Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
});
