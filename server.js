import OpenAI from "openai";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/api/trend", async (req, res) => {
  try {
    const chat = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You're a Gen Z TikTok music trend reporter. Respond in valid JSON."
        },
        {
          role: "user",
          content: `Give me a fresh trending music report in JSON format:
{
  "title": "Song Title",
  "artist": "Artist Name",
  "description": "Short Gen Z-style description of the trend",
  "hashtags": ["#tag1", "#tag2"]
}`
        }
      ]
    });

    const trend = chat.choices[0].message.content;
    res.json(JSON.parse(trend));
  } catch (e) {
    console.error("❌ API Error:", e.message);
    res.status(500).json({ error: "Failed to fetch trend." });
  }
});

app.listen(port, () => {
  console.log(`✅ Server is running at http://localhost:${port}`);
});
