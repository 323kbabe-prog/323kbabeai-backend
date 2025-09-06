// server-fast.js — minimal image generation test
// Run: node server-fast.js

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // set in your Render env
});

let imageCount = 0;
let lastImgErr = null;

async function generateImageUrl(prompt) {
  try {
    const out = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024"   // ✅ supported value
    });
    const d = out?.data?.[0];
    if (d?.url) return d.url;
  } catch (e) {
    lastImgErr = { message: e?.message || String(e) };
    console.error("[images]", lastImgErr);
  }
  return null;
}

app.get("/api/test-image", async (req, res) => {
  const prompt = req.query.prompt || "K-pop idol photocard, pastel haze, sparkles";
  const imageUrl = await generateImageUrl(prompt);
  if (imageUrl) imageCount++;

  res.json({
    prompt,
    image: imageUrl,
    count: imageCount,
    error: lastImgErr
  });
});

app.get("/diag/images", (_req,res) => res.json({ lastImgErr }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Test server running at http://localhost:${PORT}`);
});
