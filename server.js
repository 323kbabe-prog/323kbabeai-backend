// server.js — 323drop live backend (continuous pre-gen + 70+ word descriptions + locked image style)
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
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID
    ? { organization: process.env.OPENAI_ORG_ID }
    : {}),
});

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;
let nextPickCache = null;
let generatingNext = false;

/* ---------------- Helpers ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `i just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. the melody sticks in my head like glue, and i can feel the energy pulsing through every beat. the way the vocals flow on top of the rhythm makes the track feel like it was built for endless replays. it has this wild, unstoppable energy that makes me want to move, share it with friends, and relive the moment again and again until it becomes the anthem of my week.`,
    `when “${title}” comes on, i can’t help but stop scrolling and let it run, because ${artist} really caught a wave with this one. there’s something addictive about the rhythm, the way it shifts between intensity and flow, keeping me locked in every second. it feels like the perfect mix of confidence and emotion, striking that balance between boldness and vulnerability. the more i listen, the more i realize it’s one of those tracks that feels personal, yet universal, and it sticks in my head like a soundtrack i didn’t know i needed.`,
    `i’ve had “${title}” by ${artist} stuck in my head all day, and it’s not leaving anytime soon. the vocals wrap around me like a conversation with a close friend, pulling me deeper with every line, while the beat feels alive, almost breathing. every time the chorus hits, i get goosebumps, like i’m standing in the middle of a crowd shouting it back word for word. it’s one of those rare tracks that takes over the room and changes the atmosphere completely, leaving me wanting to hit repeat no matter what i’m doing.`,
    `listening to “${title}” makes me feel like i’m in on the trend before it blows up, and that’s the exact magic ${artist} nailed here. the sound is sharp, bold, and fearless, but underneath it all there’s this softness that makes it feel deeply personal. it’s the kind of song that hits like a wave — powerful, quick, and unforgettable — but also lingers long after it ends. i can see it becoming a viral anthem, the kind of track that lives in everyone’s feed, yet still feels like it was made just for me.`,
    `every time i hear “${title}” by ${artist}, i get that rush that only a viral track can bring, where the energy instantly changes the entire space around me. the production is electric, the kind of sound that fills a room and makes it brighter, louder, and impossible to ignore. it feels less like just a song and more like a cultural moment, a movement that i want to carry with me everywhere i go. with each replay, the vibe only grows stronger, embedding itself deeper, and i can’t imagine my playlist without it now.`,
  ];
  return options[Math.floor(Math.random() * options.length)];
}

function cleanForPrompt(str = "") {
  return str
    .replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "")
    .trim();
}

/* ---------------- AI Song Pick ---------------- */
async function nextNewestPick() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "you are a music trend parser." },
        {
          role: "user",
          content:
            "pick ONE current trending song (spotify or tiktok). reply ONLY as json { \"title\": \"...\", \"artist\": \"...\" }.",
        },
      ],
    });

    const text = completion.choices[0].message.content || "{}";
    let pick;
    try {
      pick = JSON.parse(text);
    } catch {
      pick = { title: "unknown", artist: "unknown" };
    }
    return {
      title: pick.title || "unknown",
      artist: pick.artist || "unknown",
      description: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#nowplaying", "#aifavorite"],
    };
  } catch {
    return {
      title: "fallback song",
      artist: "ai dj",
      description: "i just played this fallback track and it’s still a vibe.",
      hashtags: ["#ai"],
    };
  }
}

/* ---------------- Locked Image Style ---------------- */
function stylizedPrompt(title, artist) {
  return [
    `create a high-impact cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    "audience: gen-z fan culture (fans).",
    "make an original pop-idol-adjacent face and styling; do not replicate any real person or celebrity.",
    "absolutely no text, letters, numbers, logos, or watermarks.",
    "square 1:1 composition, clean crop; energetic but tasteful effects.",
    // 🔒 locked style: always the same vibe
    "style locked: stan-photocard with glossy k-pop photocard aesthetic."
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await openai.images.generate({
        model,
        prompt,
        size: "1024x1024",
        response_format: "b64_json",
      });
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
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount += 1;
    nextPickCache = {
      title: pick.title,
      artist: pick.artist,
      description: pick.description,
      hashtags: pick.hashtags,
      image: imageUrl,
      count: imageCount,
    };
  } finally {
    generatingNext = false;
  }
}

/* ---------------- Endpoints ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    let result;
    if (nextPickCache) {
      result = nextPickCache;
      nextPickCache = null;
      generateNextPick(); // prepare next one
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
        count: imageCount,
      };
      generateNextPick();
    }
    res.json(result);
  } catch {
    res.json({
      title: "fresh drop",
      artist: "323kbabeai",
      description: "text-only.",
      hashtags: ["#music", "#trend"],
      image: null,
      count: imageCount,
    });
  }
});

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

app.get("/diag/images", (_req, res) => res.json({ lastImgErr }));
app.get("/health", (_req, res) =>
  res.json({ ok: true, time: Date.now() })
);
app.get("/api/stats", (_req, res) =>
  res.json({ count: imageCount })
);

// 🔒 root endpoint for Render health check
app.get("/", (_req, res) => res.json({ ok: true }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop live backend on :${PORT}`);
  generateNextPick();
});
