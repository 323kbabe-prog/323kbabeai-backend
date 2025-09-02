import OpenAI from "openai";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/api/trend", async (req, res) => {
  try {
    // 1. Generate music trend info from GPT
    const trendChat = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You're a TikTok music trend reporter. Respond in JSON. Output format:
{
  "title": "Song Title",
  "artist": "Artist Name",
  "description": "Trendy Gen Z-style description",
  "hashtags": ["#tag1", "#tag2"]
}"
        },
        {
          role: "user",
          content: "Give me one trending TikTok song report."
        }
      ]
    });

    const trend = JSON.parse(trendChat.choices[0].message.content);

    // 2. Generate a DALL·E image for the trend
    const imagePrompt = `TikTok album cover artwork for the trending song '${trend.title}' by ${trend.artist}, modern, neon, vibrant lighting`;
    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt: imagePrompt,
      n: 1,
      size: "1024x1024"
    });

    trend.image = imageResponse.data[0].url;

    // 3. Return final response
    res.json(trend);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Failed to generate trend or image." });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
