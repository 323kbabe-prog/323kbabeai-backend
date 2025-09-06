// server.js — backend for 323drop
// Node.js v20+, CommonJS

const express = require("express");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin))
    ? cb(null, true)
    : cb(new Error("CORS: origin not allowed")),
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

/* ---------------- Helpers ---------------- */
async function nextNewestPick() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a music trend parser." },
        {
          role: "user",
          content: `Pick ONE current trending song (Spotify or TikTok).
          Return JSON: {"title":"...","artist":"...","description":"...","hashtags":["#tag1","#tag2"]}.
          - description must be first-person, 50+ words, Gen-Z style.
          - hashtags: 2–4 trending tags.`
        }
      ]
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (e) {
    console.error("pick error:", e.message);
    return {
      title: "Fallback Song",
      artist: "AI DJ",
      description: "Fallback track still slaps.",
      hashtags: ["#AI"]
    };
  }
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
    if (d?.b64_json) {
      return `data:image/png;base64,${d.b64_json}`;
    }
    return d?.url || null;
  } catch (e) {
    lastImgErr = { message: e.message };
    console.error("image error:", e.message);
    return null;
  }
}

/* ---------------- API Routes ---------------- */
app.get("/health", (_req, res) =>
  res.json({ ok: true, time: Date.now() })
);

app.get("/diag/images", (_req, res) =>
  res.json({ lastImgErr })
);

app.get("/api/stats", (_req, res) =>
  res.json({ count: imageCount })
);

app.get("/api/trend", async (_req, res) => {
  try {
    const pick = await nextNewestPick();
    const prompt = `Cover image for "${pick.title}" by ${pick.artist}, Gen-Z idol style.`;
    const imageUrl = await generateImageUrl(prompt);

    if (imageUrl) imageCount++;

    res.json({
      ...pick,
      image: imageUrl,
      count: imageCount
    });
  } catch (e) {
    res.json({
      title: "Error",
      artist: "AI",
      description: "No data available.",
      hashtags: ["#error"],
      image: null,
      count: imageCount
    });
  }
});

app.get("/api/voice", async (req, res) => {
  try {
    const text = String(req.query.text || "").slice(0, 2000);
    if (!text) return res.status(400).json({ error: "Missing text" });

    const out = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      format: "mp3"
    });

    const buffer = Buffer.from(await out.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (e) {
    console.error("voice error:", e.message);
    res.status(500).json({ error: "TTS failed" });
  }
});

/* ---------------- Static Files ---------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop backend on :${PORT}`);
});
