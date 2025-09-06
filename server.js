// server.js — 323drop Live (AI Favorite Pick + Always Korean Idol + Fresh AI description + Safe prompt sanitization + No repeat + Young voice only)
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
let lastSong = null; // remember last pick to avoid repeats

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
  },
  "poster-wall": {
    description: "DIY bedroom poster wall — shareable fan collage energy",
    tags: [
      "layered paper textures with tape corners and torn edges",
      "implied magazine clippings WITHOUT readable text or logos",
      "pastel + neon accents, soft shadowed layers",
      "subject in front with crisp rim light; background defocused collage",
      "sparkle confetti and star cutouts; tasteful grain",
      "original, non-celeb face with pop-idol charisma"
    ]
  },
  "glow-stage-fan": {
    description: "arena lightstick glow — concert-night fan moment",
    tags: [
      "dark stage background with colorful beam lights and haze",
      "bokeh crowd dots; generic lightstick silhouettes (no branding)",
      "hot rim light on hair and shoulders; motion vibe",
      "bold neon accents (electric cyan, hot pink, laser purple)",
      "no text, no numbers, no logos; original performer vibe"
    ]
  },
  "y2k-stickerbomb": {
    description: "Y2K candycore — playful stickerbomb pop aesthetic",
    tags: [
      "candy tones (cotton-candy pink, lime soda, sky cyan); glossy highlights",
      "airbrush hearts and starbursts as shapes only",
      "phone-camera flash look with mild bloom",
      "floating sticker motifs around subject; keep face clean",
      "no typography; original pop-idol energy"
    ]
  },
  "street-fandom": {
    description: "urban fan-cam energy — trendy city-night shareability",
    tags: [
      "city night backdrop; neon sign SHAPES only (no readable words)",
      "low-angle phone-cam feel; slight motion trail on hair/jackets",
      "wet asphalt reflections; cinematic contrast",
      "light leak edges; tiny dust particles",
      "original influencer face; not a real celebrity"
    ]
  }
};

const DEFAULT_STYLE = process.env.DEFAULT_STYLE || "stan-photocard";

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
  // always fallback to young female
  return "shimmer";
}
function cleanForPrompt(str = "") {
  return str.replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "").trim();
}

/* ---------------- AI Favorite Pick (real trending + fresh desc + no repeat) ---------------- */
async function nextNewestPick() {
  try {
    // Step 1: pick a real trending song, avoiding repeats
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a music trend parser." },
        { 
          role: "user", 
          content: `Pick ONE real trending song that is currently viral on TikTok, Spotify, or YouTube Shorts. 
          Reply ONLY as JSON { "title": "...", "artist": "..." }. 
          Do not invent songs. 
          Do not repeat the last pick: ${lastSong ? JSON.stringify(lastSong) : "none"}.`
        }
      ]
    });

    let pick;
    try {
      pick = JSON.parse(completion.choices[0].message.content || "{}");
    } catch {
      pick = { title: "Unknown", artist: "Unknown" };
    }

    // Step 2: fresh AI description
    let descOut = "";
    try {
      const desc = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Write like a Gen-Z fan describing a viral song." },
          { role: "user", content: `Write a unique 60-80 word first-person description of why "${pick.title}" by ${pick.artist} is trending.` }
        ]
      });
      descOut = desc.choices[0].message.content.trim();
    } catch {
      descOut = "This track is buzzing everywhere right now.";
    }

    // save last song for repeat-prevention
    lastSong = { title: pick.title, artist: pick.artist };

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      desc: descOut,
      hashtags: ["#NowPlaying", "#TrendingNow", "#AIFavorite"]
    };
  } catch (e) {
    return {
      title: "Fallback Song",
      artist: "AI DJ",
      desc: "Couldn’t fetch the latest trend — but this track still sets the vibe.",
      hashtags: ["#AITrend"]
    };
  }
}

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE, extraVibe = [], inspoTags = []) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    "The performer should appear as a young " + genderFromArtist(artist) + " Korean idol (Gen-Z style).",
    ...s.tags.map(t => `• ${t}`),
    ...(extraVibe.length ? ["Vibe details:", ...extraVibe.map(t => `• ${t}`)] : []),
    ...(inspoTags.length ? ["Inspiration notes (style only, not likeness):", ...inspoTags.map(t => `• ${t}`)] : [])
  ].join(" ");
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

/* ---------------- Diagnostics ---------------- */
app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));
app.get("/diag/env", (_req,res) => res.json({
  has_OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
  has_OPENAI_ORG_ID:  Boolean(process.env.OPENAI_ORG_ID),
  DEFAULT_STYLE,
  node: process.version,
}));
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));
app.get("/api/stats", (_req, res) => res.set("Cache-Control","no-store").json({ count: imageCount }));

/* ---------------- SSE stream ---------------- */
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
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    send("status", { msg: "generating image…" });
    const imageUrl = await generateImageUrl(prompt);
    if (lastImgErr) send("diag", lastImgErr);

    send("trend", pick);

    if (imageUrl) {
      imageCount += 1;
      send("count", { count: imageCount });
      send("image", { src: imageUrl });
      send("status", { msg: "done" });
      send("end", { ok:true });
    } else {
      send("status", { msg: "image unavailable." });
      send("end", { ok:false });
    }
  } catch (e) {
    send("status", { msg: `error: ${e?.message || e}` });
    send("end", { ok:false });
  } finally {
    clearInterval(hb);
    res.end();
  }
});

/* ---------------- JSON one-shot ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;

    res.json({
      title: pick.title,
      artist: pick.artist,
      description: pick.desc,
      hashtags: pick.hashtags,
      image: imageUrl,
      count: imageCount
    });
  } catch (e) {
    res.json({
      title: "Fresh Drop",
      artist: "323KbabeAI",
      description: "Text-only.",
      hashtags: ["#music","#trend"],
      image: null,
      count: imageCount
    });
  }
});

/* ---------------- Voice (TTS) ---------------- */
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
  console.log(`323drop live backend on :${PORT}`);
  console.log("OpenAI key present:", !!process.env.OPENAI_API_KEY, "| Org set:", !!process.env.OPENAI_ORG_ID, "| Default style:", DEFAULT_STYLE);
});
