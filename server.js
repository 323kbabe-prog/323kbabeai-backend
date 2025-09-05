// server.js — 323drop Live (AI Favorite Pick + Always Korean Idol + First-person description 50+ words + Safe prompt sanitization)
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

/* ---------------- Gen‑Z fans style system ---------------- */
const STYLE_PRESETS = {
  "stan-photocard": {
    description: "lockscreen-ready idol photocard vibe for Gen‑Z fan culture",
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

/* ---------------- Sanitize titles/artists for image prompt ---------------- */
function cleanForPrompt(str = "") {
  return str.replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "").trim();
}

/* ---------------- AI Favorite Pick ---------------- */
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
    } catch (err) {
      console.error("JSON parse error:", err.message, "Raw text:", text);
      pick = { title: "Unknown", artist: "Unknown" };
    }

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      desc: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying", "#AIFavorite"]
    };
  } catch (e) {
    console.error("Favorite pick failed:", e.message);
    return { title: "Fallback Song", artist: "AI DJ", desc: "I just played this fallback track and it's still a vibe.", hashtags: ["#AI"] };
  }
}

/* ---------------- Prompt builder (always Korean idol style + sanitized input) ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE, extraVibe = [], inspoTags = []) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    "The performer must always appear Korean, styled like a young K-pop idol (inspired by fan culture visuals).",
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


/* ---------------- Prefetch ---------------- */
let nextPrefetch = null;

async function prefetchNext() {
  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const cacheKey = `${pick.title}|${pick.artist}|${DEFAULT_STYLE}`;
    const imageUrl = await generateImageUrl(prompt, cacheKey);
    if (imageUrl) {
      nextPrefetch = { ...pick, image: imageUrl, cacheKey };
      console.log("[prefetch] Cached next image:", pick.title, "by", pick.artist);
    }
  } catch (e) {
    console.error("[prefetch failed]", e.message);
    nextPrefetch = null;
  }
}

/* ---------------- JSON one-shot ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    let pick, imageUrl, cacheKey;

    if (nextPrefetch) {
      ({ title: pickTitle, artist: pickArtist, desc, hashtags, image: imageUrl, cacheKey } = nextPrefetch);
      pick = { title: pickTitle, artist: pickArtist, desc, hashtags };
      nextPrefetch = null;
    } else {
      pick = await nextNewestPick();
      const prompt = stylizedPrompt(pick.title, pick.artist);
      cacheKey = `${pick.title}|${pick.artist}|${DEFAULT_STYLE}`;
      imageUrl = await generateImageUrl(prompt, cacheKey);
    }

    if (imageUrl) imageCount += 1;

    // 🚀 Start background prefetch for the next one
    prefetchNext();

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
      voice: "alloy", // can be changed to "verse", "sage", etc.
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
