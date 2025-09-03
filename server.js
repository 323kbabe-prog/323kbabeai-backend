// server.js (inside /api/trend route)
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/api/trend", async (req, res) => {
  try {
    const title = "She’s a 10 but… (sped up)";
    const artist = "Luh Tempo";
    const description = "Blowing up on TikTok dance edits; memeable hook + switch-up.";
    const hashtags = ["#TikTokSong", "#SpedUp"];

    // ✅ FIXED: use supported size
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `Aesthetic cover-art style visual for a trending TikTok song "${title}" by ${artist}. Neon, moody, no text overlay.`,
      size: "1024x1024",  // was "512x512"
    });

    const imageUrl = img?.data?.[0]?.url || null;

    res.json({
      title,
      artist,
      description,
      hashtags,
      image: imageUrl,
      count: ++imageCount,
    });
  } catch (err) {
    console.error("Trend endpoint error:", err?.response?.data || err?.message || err);
    res.status(200).json({
      title: "Trend unavailable",
      artist: "—",
      description: "Image generation failed. Showing fallback.",
      hashtags: ["#oops"],
      image: null,
      count: imageCount,
      error: "Failed to generate trend image",
    });
  }
});
