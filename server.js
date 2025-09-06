// server.js — 323drop Super Fast Image Mode
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) =>
    (!origin || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ---------------- Image generator (super fast) ---------------- */
async function generateImageUrl(prompt) {
  try {
    const out = await openai.images.generate({
      model: "gpt-image-1",       // fastest model
      prompt,                     // minimal sanitized prompt
      size: "512x512",            // fastest render
      response_format: "url"      // no base64 overhead
    });
    return out.data[0]?.url || null;
  } catch (e) {
    console.error("[images]", e.message);
    return null;
  }
}

/* ---------------- Trend API (fast image only) ---------------- */
app.get("/api/trend", async (req, res) => {
  try {
    const title = "AI Favorite Pick";
    const artist = "323drop Idol";

    const prompt = `Create a shareable K-pop style idol cover image for "${title}" by ${artist}.
    Young Korean idol, Gen-Z style, square 1:1 composition.
    No text, no logos, no numbers.`;

    const imageUrl = await generateImageUrl(prompt);

    res.json({
      title,
      artist,
      image: imageUrl,
    });
  } catch (e) {
    res.json({
      title: "Fallback Song",
      artist: "AI Idol",
      image: null,
    });
  }
});

/* ---------------- Health ---------------- */
app.get("/health", (_req, res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`323drop super fast backend on :${PORT}`);
  console.log("OpenAI key present:", !!process.env.OPENAI_API_KEY);
});