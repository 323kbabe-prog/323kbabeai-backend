// 🟣 FINAL server.js for 323KbabeAI (Image Generation Mode)
// Make sure OPENAI_API_KEY is injected in Render environment

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Configuration, OpenAIApi } from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

// 🔢 Track how many times image has been generated
let imageGenCount = 0;

app.get('/api/trend', async (req, res) => {
  try {
    // Trend data (can later come from dynamic search)
    const trends = [
      {
        title: "Good 4 U",
        artist: "Olivia Rodrigo",
        description: "Breakup anthem with a pop-punk twist, inspiring creative lip-syncs and skits.",
        hashtags: ["#Good4U", "#OliviaRodrigo"]
      },
      {
        title: "Stay",
        artist: "The Kid LAROI and Justin Bieber",
        description: "This catchy tune sets the scene for comedic or dramatic moments. Used in over 1.5 million videos.",
        hashtags: ["#Stay", "#TheKidLAROI", "#JustinBieber", "#Trend"]
      },
      {
        title: "Industry Baby",
        artist: "Lil Nas X ft. Jack Harlow",
        description: "Viral challenge marked by a funky dance routine. Paired with self-transformation videos.",
        hashtags: ["#industrybaby", "#lilnasx", "#challenge"]
      }
    ];

    const trend = trends[Math.floor(Math.random() * trends.length)];

    // 🎨 Generate image using DALL·E
    const imageResponse = await openai.createImage({
      prompt: `${trend.title} by ${trend.artist}, album cover art`,
      n: 1,
      size: "512x512"
    });

    const imageUrl = imageResponse?.data?.data[0]?.url;
    if (!imageUrl) throw new Error('No image URL');

    imageGenCount++;

    res.json({
      ...trend,
      image: imageUrl,
      count: imageGenCount
    });

  } catch (error) {
    console.error('[/api/trend] Error:', error.message);
    res.status(500).json({ error: 'Failed to generate trend image.' });
  }
});

// 📊 Get image generation count
app.get('/api/stats', (req, res) => {
  res.json({ count: imageGenCount });
});

app.listen(port, () => {
  console.log(`🔥 323KbabeAI running at http://localhost:${port}`);
});
