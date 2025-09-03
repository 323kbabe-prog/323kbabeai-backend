// server.js (CommonJS)
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
app.use(cors({ origin: true }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // optional if you’re in multiple orgs (use the verified one):
  organization: process.env.OPENAI_ORG_ID,
});

let imageCount = 0;

app.get("/api/stats", (_, res) => res.json({ count: imageCount }));

// Helper: try multiple models and accept url or base64
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"]; // try gpt-image-1, then fallback to DALL·E 3
  for (const model of models) {
    try {
      const out = await openai.images.generate({ model, prompt, size: "1024x1024" });
      const d = out?.data?.[0];
      const url = d?.url || (d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null);
      if (url) return url;
    } catch (e) {
      // keep trying next model; useful for 403 (org not verified) on gpt-image-1
      console.error(`[images] ${model} failed:`, e?.status || "", e?.message || e);
    }
  }
  return null;
}

app.get("/api/trend", async (_, res) => {
  const title = "She’s a 10 but… (sped up)";
  const artist = "Luh Tempo";
  const description = "Blowing up on TikTok dance edits; memeable hook + switch-up.";
  const hashtags = ["#TikTokSong", "#SpedUp"];

  try {
    const prompt = `Aesthetic cover-art visual for "${title}" by ${artist}. Neon, moody, cinematic, NO text overlay.`;
    const imageUrl = await generateImageUrl(prompt);

    if (imageUrl) imageCount += 1;

    return res.json({
      title, artist, description, hashtags,
      image: imageUrl,            // may be https URL or data: URI
      count: imageCount,
    });
  } catch (err) {
    console.error("trend route error:", err?.message || err);
    return res.status(200).json({
      title, artist, description, hashtags,
      image: null,
      count: imageCount,
      error: "Failed to generate trend image",
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323KbabeAI backend on :${PORT}`));
