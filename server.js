import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.static('.'));
app.use(express.json());

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

app.get('/api/trend', async (req, res) => {
  try {
    const chat = await openai.createChatCompletion({
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

    const raw = chat.data.choices[0].message.content;
    const parsed = JSON.parse(raw);
    res.json(parsed);

  } catch (e) {
    console.error("❌ API error:", e.message);
    res.status(500).json({ error: "Failed to fetch trend." });
  }
});

app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`);
});
