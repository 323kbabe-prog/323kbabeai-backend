// server.js — 323drop Live (Spotify Top 50 USA + OpenAI description + OpenAI images + Google TTS voice)
// Node >= 20, CommonJS

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const textToSpeech = require("@google-cloud/text-to-speech");

const app = express();

/* ---------------- CORS ---------------- */
const ALLOW = ["https://1ai323.ai", "https://www.1ai323.ai"];
app.use(cors({
  origin: (origin, cb) => (!origin || ALLOW.includes(origin)) ? cb(null, true) : cb(new Error("CORS: origin not allowed")),
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

/* ---------------- OpenAI ---------------- */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  ...(process.env.OPENAI_ORG_ID ? { organization: process.env.OPENAI_ORG_ID } : {}),
});

/* ---------------- Google TTS ---------------- */
const googleTTSClient = new textToSpeech.TextToSpeechClient();

async function googleTTS(text, style = "female") {
  const voiceMap = {
    female: { languageCode: "en-US", name: "en-US-Neural2-F", ssmlGender: "FEMALE" },
    male:   { languageCode: "en-US", name: "en-US-Neural2-D", ssmlGender: "MALE" }
  };
  const voice = voiceMap[style] || voiceMap.female;

  const [response] = await googleTTSClient.synthesizeSpeech({
    input: { text },
    voice,
    audioConfig: { audioEncoding: "MP3" }
  });

  if (!response.audioContent) {
    console.error("❌ Google TTS returned no audio for:", text);
    return null;
  }

  console.log("✅ Google TTS audio length:", response.audioContent.length);
  return Buffer.from(response.audioContent, "binary");
}

/* ---------------- State ---------------- */
let lastImgErr = null;

/* ---------------- Spotify Top 50 USA ---------------- */
const TOP50_USA = [
  { title: "The Subway", artist: "Chappell Roan", gender: "female" },
  { title: "Golden", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Your Idol", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast", gender: "male" },
  { title: "Soda Pop", artist: "Saja Boys, Andrew Choi, Neckwav, Danny Chung, KEVIN WOO, samUIL Lee, KPop Demon Hunters Cast", gender: "male" },
  { title: "How It’s Done", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "back to friends", artist: "sombr", gender: "male" },
  { title: "DAISIES", artist: "Justin Bieber", gender: "male" },
  { title: "Ordinary", artist: "Alex Warren", gender: "male" },
  { title: "What It Sounds Like", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Takedown", artist: "HUNTR/X, EJAE, Audrey Nuna & Rei Ami, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Love Me Not", artist: "Ravyn Lenae", gender: "female" },
  { title: "Free", artist: "Rumi, Jinu, EJAE, Andrew Choi, KPop Demon Hunters Cast", gender: "mixed" },
  { title: "Dreams (2004 Remaster)", artist: "Fleetwood Mac", gender: "mixed" },
  { title: "What I Want (feat. Tate McRae)", artist: "Morgan Wallen, Tate McRae", gender: "mixed" },
  { title: "undressed", artist: "sombr", gender: "male" },
  { title: "Manchild", artist: "Sabrina Carpenter", gender: "female" },
  { title: "I Got Better", artist: "Morgan Wallen", gender: "male" },
  { title: "Just In Case", artist: "Morgan Wallen", gender: "male" },
  { title: "No One Noticed", artist: "The Marías", gender: "female" },
  { title: "BIRDS OF A FEATHER", artist: "Billie Eilish", gender: "female" },
  { title: "Last Time I Saw You", artist: "Nicki Minaj", gender: "female" },
  { title: "Need You Now", artist: "Lady Antebellum", gender: "mixed" },
  { title: "One of the Girls", artist: "The Weeknd, JENNIE, Lily-Rose Depp", gender: "mixed" },
  { title: "Paint The Town Red", artist: "Doja Cat", gender: "female" },
  { title: "Lose Yourself", artist: "Eminem", gender: "male" },
  { title: "Die With A Smile", artist: "Lady Gaga & Bruno Mars", gender: "mixed" },
  { title: "Luther", artist: "Kendrick Lamar & SZA", gender: "mixed" },
  { title: "Ordinary (Acoustic)", artist: "Alex Warren", gender: "male" },
  { title: "TEXAS HOLD 'EM", artist: "Beyoncé", gender: "female" },
  { title: "Houdini", artist: "Dua Lipa", gender: "female" },
  { title: "Espresso", artist: "Sabrina Carpenter", gender: "female" },
  { title: "Snow On The Beach", artist: "Taylor Swift, Lana Del Rey", gender: "female" },
  { title: "Gently", artist: "Drake feat. Bad Bunny", gender: "male" },
  { title: "Cruel Summer", artist: "Taylor Swift", gender: "female" },
  { title: "I Like The Way You Kiss Me", artist: "Artemas", gender: "male" },
  { title: "Seven (feat. Latto)", artist: "Jung Kook, Latto", gender: "male" },
  { title: "IDGAF", artist: "Drake", gender: "male" },
  { title: "Too Sweet", artist: "Hozier", gender: "male" },
  { title: "Slime You Out", artist: "Drake feat. SZA", gender: "mixed" },
  { title: "Barbie World", artist: "Nicki Minaj, Ice Spice, Aqua", gender: "female" },
  { title: "Peaches", artist: "Justin Bieber feat. Daniel Caesar & Giveon", gender: "male" },
  { title: "Up", artist: "Cardi B", gender: "female" },
  { title: "MONTERO (Call Me By Your Name)", artist: "Lil Nas X", gender: "male" },
  { title: "drivers license", artist: "Olivia Rodrigo", gender: "female" },
  { title: "Shivers", artist: "Ed Sheeran", gender: "male" },
  { title: "Blinding Lights", artist: "The Weeknd", gender: "male" },
  { title: "As It Was", artist: "Harry Styles", gender: "male" },
  { title: "Flowers", artist: "Miley Cyrus", gender: "female" },
  { title: "Levitating", artist: "Dua Lipa", gender: "female" }
];

/* ---------------- Helpers ---------------- */
async function makeFirstPersonDescription(title, artist) {
  try {
    const prompt = `
      Write a minimum 70-word first-person description of the song "${title}" by ${artist}.
      Mimic the artist’s personality, mood, and style (e.g., Billie Eilish = moody, Eminem = intense, Taylor Swift = storytelling).
      Make it sound natural, Gen-Z relatable, and as if the artist themselves is talking about their own song.
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      messages: [
        { role: "system", content: "You are a music fan channeling the artist’s voice in first person." },
        { role: "user", content: prompt }
      ]
    });

    return completion.choices[0].message.content.trim();
  } catch (e) {
    console.error("❌ OpenAI description generation failed:", e.message);
    return `I just played “${title}” by ${artist}, and the vibe stuck with me instantly — unforgettable and addictive.`;
  }
}

function pickSongAlgorithm() {
  const weightTop = 0.7;
  let pool = Math.random() < weightTop ? TOP50_USA.slice(0, 20) : TOP50_USA.slice(20);
  if (!pool.length) pool = TOP50_USA;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

function stylizedPrompt(title, artist, gender) {
  return [
    `Create a high-impact, shareable cover image for the song "${title}" by ${artist}.`,
    "Audience: Gen-Z fan culture. Visual goal: lockscreen-ready idol photocard vibe.",
    "Make an ORIGINAL idol-like face and styling; do NOT replicate real celebrities.",
    "Absolutely no text, logos, or watermarks.",
    "Square 1:1 composition.",
    `The performer should appear as a young ${gender} Korean idol (Gen-Z style).`,
    "• square 1:1 cover, subject centered, shoulders-up or half-body",
    "• flash-lit glossy skin with subtle K-beauty glow",
    "• pastel gradient background (milk pink, baby blue, lilac) with haze",
    "• sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
    "• tiny glitter bokeh and lens glints",
    "• clean studio sweep look; light falloff; subtle film grain",
    "• original influencer look — not a specific or real celebrity face"
  ].join(" ");
}

/* ---------------- API: Full Pipeline ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    // 1. Pick song
    const pick = pickSongAlgorithm();

    // 2. Generate description
    const description = await makeFirstPersonDescription(pick.title, pick.artist);

    // 3. Generate image
    const prompt = stylizedPrompt(pick.title, pick.artist, pick.gender);
    const out = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      response_format: "b64_json"
    });
    const d = out?.data?.[0];
    const imageUrl = d?.b64_json ? `data:image/png;base64,${d.b64_json}` : null;

    // 4. Generate voice from description
    const audioBuffer = await googleTTS(description, "female");
    const voiceBase64 = audioBuffer ? audioBuffer.toString("base64") : null;

    // 5. Return JSON with everything
    res.json({
      title: pick.title,
      artist: pick.artist,
      gender: pick.gender,
      description,
      hashtags: ["#NowPlaying", "#AIFavorite"],
      image: imageUrl,
      voice: voiceBase64 ? `data:audio/mpeg;base64,${voiceBase64}` : null,
      refresh: 3000
    });
  } catch (e) {
    console.error("❌ Trend pipeline failed:", e);
    res.status(500).json({ error: "Pipeline failed" });
  }
});

/* ---------------- Health ---------------- */
app.get("/health", (_req,res) => res.json({ ok: true, time: Date.now() }));

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`323drop live backend on :${PORT}`));
