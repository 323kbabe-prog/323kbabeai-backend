// server.js — AI Favorite Pick + Always Korean Idol + First-person description (50+ words) + Auto voice read-out

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { fetch } = require("undici");

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

/* ---------------- State ---------------- */
let imageCount = 0;
let lastImgErr = null;

/* ---------------- Styles ---------------- */
const STYLE_PRESETS = {
  "stan-photocard": {
    description: "lockscreen-ready idol photocard vibe for Gen‑Z fan culture",
    tags: [
      "square 1:1 cover, subject centered, shoulders-up or half-body",
      "flash-lit glossy skin with subtle K-beauty glow",
      "pastel gradient background (milk pink, baby blue, lilac) with haze",
      "sticker shapes ONLY (hearts, stars, sparkles) floating lightly",
      "tiny glitter bokeh and lens glints",
      "clean studio sweep look; light falloff; subtle film grain",
      "original influencer look — not a specific or real celebrity face"
    ]
  }
};

const DEFAULT_STYLE = process.env.DEFAULT_STYLE || "stan-photocard";

/* ---------------- First-person description (50+ words) ---------------- */
function makeFirstPersonDescription(title, artist) {
  const options = [
    `I just played “${title}” by ${artist} and it hit me instantly — the vibe is unreal. The melody sticks in my head like glue, and I can feel the energy pulsing through every beat. It makes me want to get up, move, and share it with everyone I know, because it really feels like a soundtrack to this exact moment in time.`,
    `When “${title}” comes on, I can’t help but stop scrolling and let it run. ${artist} really caught a wave with this one. There’s something addictive about the rhythm, the way it shifts between intensity and flow. It feels like a perfect mix of confidence and emotion, and I swear I could loop it all day and not get tired.`,
    `I’ve had “${title}” by ${artist} stuck in my head all day, and it’s not leaving anytime soon. The vocals wrap around me like a conversation with a close friend, and the beat feels alive. Every time the chorus hits, I get goosebumps, like I’m standing in the middle of a crowd singing it back word for word.`,
    `Listening to “${title}” makes me feel like I’m in on the trend before it blows up. ${artist} nailed the energy here. The sound is sharp, bold, and fearless, but it also has this soft undercurrent that makes it so personal. I love that it feels both viral and intimate at the same time, like it’s written for the world but also just for me.`,
    `Every time I hear “${title}” by ${artist}, I get that rush that only a viral track can bring. It’s wild how a song can instantly change the atmosphere of a room, making it brighter and louder. This one feels like a moment — not just music, but a movement that I want to carry with me everywhere and keep on repeat.`
  ];
  return options[Math.floor(Math.random() * options.length)];
}

/* ---------------- Sanitize for prompts ---------------- */
function cleanForPrompt(str = "") {
  return str.replace(/(kill|suicide|murder|die|sex|naked|porn|gun|weapon)/gi, "").trim();
}

/* ---------------- AI Favorite Pick ---------------- */
async function nextNewestPick() {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a music trend parser." },
        { role: "user", content: "Pick ONE current trending song (Spotify or TikTok). Reply ONLY as JSON { \"title\": \"...\", \"artist\": \"...\" }." }
      ]
    });
    const text = completion.choices[0].message.content || "{}";
    let pick;
    try { pick = JSON.parse(text); } catch { pick = { title: "Unknown", artist: "Unknown" }; }

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      desc: makeFirstPersonDescription(pick.title, pick.artist),
      hashtags: ["#NowPlaying","#AIFavorite"]
    };
  } catch {
    return { title: "Fallback Song", artist: "AI DJ", desc: "I just played this fallback track and it's still a vibe.", hashtags: ["#AI"] };
  }
}

/* ---------------- Prompt builder ---------------- */
function stylizedPrompt(title, artist, styleKey = DEFAULT_STYLE) {
  const s = STYLE_PRESETS[styleKey] || STYLE_PRESETS["stan-photocard"];
  return [
    `Create a high-impact, shareable cover image for the song "${cleanForPrompt(title)}" by ${cleanForPrompt(artist)}.`,
    `Audience: Gen-Z fan culture (fans). Visual goal: ${s.description}.`,
    "Make an ORIGINAL pop-idol-adjacent face and styling; do NOT replicate any real person or celebrity.",
    "Absolutely no text, letters, numbers, logos, or watermarks.",
    "Square 1:1 composition, clean crop; energetic but tasteful effects.",
    "The performer must always appear Korean, styled like a young K-pop idol (inspired by fan culture visuals).",
    ...s.tags.map(t => `• ${t}`)
  ].join(" ");
}

/* ---------------- Image generation ---------------- */
async function generateImageUrl(prompt) {
  const models = ["gpt-image-1", "dall-e-3"];
  for (const model of models) {
    try {
      const out = await openai.images.generate({ model, prompt, size: "1024x1024", response_format: "b64_json" });
      const d = out?.data?.[0];
      if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
      if (d?.url) return d.url;
    } catch (e) { lastImgErr = { model, message: e.message }; }
  }
  return null;
}

/* ---------------- TTS Endpoint ---------------- */
app.get("/api/voice", async (req, res) => {
  try {
    const text = req.query.text || "Hello, this is AI speaking.";
    const tts = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
    });
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(await tts.arrayBuffer()));
  } catch (e) {
    res.status(500).send("TTS failed");
  }
});

/* ---------------- SSE ---------------- */
app.get("/api/trend-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

  send("hello", { ok: true });

  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    send("trend", pick);
    if (imageUrl) { imageCount++; send("count", { count: imageCount }); send("image", { src: imageUrl }); }
    send("end", { ok:true });
  } catch (e) { send("end", { ok:false }); }
});

/* ---------------- JSON one-shot ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    const pick = await nextNewestPick();
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (imageUrl) imageCount++;
    res.json({ ...pick, image: imageUrl, count: imageCount });
  } catch {
    res.json({ title: "Fresh Drop", artist: "323KbabeAI", description: "Text-only.", hashtags: ["#music","#trend"], image: null, count: imageCount });
  }
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on port", PORT));
