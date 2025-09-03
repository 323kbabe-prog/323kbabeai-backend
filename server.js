// server.js
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

// --- CORS: allow your domain(s) ---
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOW.includes(origin)) return cb(null, true);
    return cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));

// --- OpenAI client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// simple in-memory counter (replace with DB if needed)
let imageCount = 0;

app.get("/api/stats", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ count: imageCount });
});

app.get("/api/trend", async (req, res) => {
  // Replace this stub with your real trend selector
  const title = "She’s a 10 but… (sped up)";
  const artist = "Luh Tempo";
  const description = "Blowing up on TikTok dance edits; memeable hook + switch-up.";
  const hashtags = ["#TikTokSong", "#SpedUp"];

  try {
    // ✅ Supported sizes: 1024x1024, 1024x1792, 1792x1024
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `Aesthetic cover-art style visual for trending TikTok track "${title}" by ${artist}. Neon, moody, cinematic lighting, NO text overlay.`,
      size: "1024x1024",
    });

    const imageUrl = img && img.data && img.data[0] && img.data[0].url ? img.data[0].url : null;

    if (!imageUrl) {
      // Still return text so the UI shows the card
      return res.status(200).json({
        title, artist, description, hashtags,
        image: null,
        count: imageCount,
        error: "Image URL missing from OpenAI response",
      });
    }

    imageCount += 1;

    res.set("Cache-Control", "no-store");
    return res.json({ title, artist, description, hashtags, image: imageUrl, count: imageCount });

  } catch (err) {
    console.error("Trend endpoint error:", err?.response?.data || err?.message || err);
    // Per your spec: return text even when image gen fails
    return res.status(200).json({
      title, artist, description, hashtags,
      image: null,
      count: imageCount,
      error: err?.response?.data?.error?.message || err?.message || "Failed to generate trend image",
    });
  }
});

// Render provides PORT; fall back for local dev
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323KbabeAI backend running on :${PORT}`);
});
