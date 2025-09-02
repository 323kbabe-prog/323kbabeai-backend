// server.js — DALL·E image generation backend for 323KbabeAI with persistent image count

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Load or initialize persistent count file
const countFilePath = path.resolve("image-count.json");
let imageGenerationCount = 0;

if (fs.existsSync(countFilePath)) {
  const saved = JSON.parse(fs.readFileSync(countFilePath, "utf-8"));
  imageGenerationCount = saved.count || 0;
} else {
  fs.writeFileSync(countFilePath, JSON.stringify({ count: 0 }, null, 2));
}

const sampleTrends = [
  {
    title: "Good 4 U",
    artist: "Olivia Rodrigo",
    description: "Breakup anthem with a pop-punk twist, inspiring creative lip-syncs and skits.",
    hashtags: ["#Good4U", "#OliviaRodrigo"]
  },
  {
    title: "Montero (Call Me By Your Name)",
    artist: "Lil Nas X",
    description: "This controversial track has created loads of reaction videos, make-up looks, and fashion recreations.",
    hashtags: ["#Montero", "#LilNasX", "#TrendReaction"]
  },
  {
    title: "Levitating",
    artist: "Dua Lipa",
    description: "An all-time Gen Z favorite for dance challenges and fashion transitions.",
    hashtags: ["#Levitating", "#DuaLipa"]
  }
];

app.get("/api/trend", async (req, res) => {
  try {
    const trend = sampleTrends[Math.floor(Math.random() * sampleTrends.length)];
    const prompt = `Album art in vibrant pop style for the song \"${trend.title}\" by ${trend.artist}`;

    const imageResponse = await openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "512x512"
    });

    trend.image = imageResponse.data[0].url;
    imageGenerationCount++;

    // Save to disk
    fs.writeFileSync(countFilePath, JSON.stringify({ count: imageGenerationCount }, null, 2));

    res.json({ ...trend, count: imageGenerationCount });
  } catch (err) {
    console.error("DALL·E error:", err.message);
    res.status(500).json({ error: "Failed to generate trend image." });
  }
});

app.get("/api/stats", (req, res) => {
  res.json({ imageGenerations: imageGenerationCount });
});

app.listen(port, () => {
  console.log(`✅ 323KbabeAI backend (persistent mode) running on port ${port}`);
});
