import OpenAI from "openai";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Utility to fetch image from DuckDuckGo (or fallback)
async function fetchImageFromWeb(query) {
  try {
    const searchUrl = \`https://api.duckduckgo.com/?q=\${encodeURIComponent(query)}&format=json&no_redirect=1&t=kbabeai\`;
    const res = await fetch(searchUrl);
    const data = await res.json();
    if (data.Image && data.Image.startsWith("http")) {
      return data.Image;
    }
    return "https://via.placeholder.com/400x400/111111/FFFFFF?text=Trending+Track";
  } catch (err) {
    console.error("❌ Image fetch error:", err.message);
    return "https://via.placeholder.com/400x400/111111/FFFFFF?text=Trending+Track";
  }
}

app.get("/api/trend", async (req, res) => {
  try {
    // Step 1: Get trend from GPT
    const trendChat = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You're a Gen Z TikTok trend reporter. Respond in JSON ONLY. Format:
{
  "title": "Song Title",
  "artist": "Artist Name",
  "description": "Trendy Gen Z-style description",
  "hashtags": ["#tag1", "#tag2"]
}"
        },
        {
          role: "user",
          content: "Give me a fresh TikTok trending song report."
        }
      ]
    });

    const trend = JSON.parse(trendChat.choices[0].message.content);

    // Step 2: Fetch dynamic image
    const searchQuery = \`\${trend.title} \${trend.artist} album cover\`;
    trend.image = await fetchImageFromWeb(searchQuery);

    // Step 3: Respond
    res.json(trend);
  } catch (err) {
    console.error("❌ GPT or image error:", err);
    res.status(500).json({ error: "Failed to fetch trend." });
  }
});

app.listen(port, () => {
  console.log("✅ Dynamic server running at http://localhost:" + port);
});
