/* ---------------- Prefetch state ---------------- */
let nextCachedTrend = null;

async function generateTrendAndImage() {
  const pick = await nextNewestPick();
  const prompt = stylizedPrompt(pick.title, pick.artist);
  const imageUrl = await generateImageUrl(prompt);
  if (imageUrl) imageCount += 1;

  return {
    title: pick.title,
    artist: pick.artist,
    description: pick.desc,
    hashtags: pick.hashtags,
    image: imageUrl,
    count: imageCount
  };
}

/* ---------------- JSON one-shot with prefetch ---------------- */
app.get("/api/trend", async (_req, res) => {
  try {
    // If we already have a cached trend ready, use it immediately
    if (nextCachedTrend) {
      const out = nextCachedTrend;
      nextCachedTrend = null; // consume cache
      res.json(out);

      // start prefetching again in background
      generateTrendAndImage().then(r => { nextCachedTrend = r; });
      return;
    }

    // otherwise, generate now + kick off prefetch
    const out = await generateTrendAndImage();
    res.json(out);

    // prefetch the next one
    generateTrendAndImage().then(r => { nextCachedTrend = r; });

  } catch (e) {
    res.json({ title: "Fallback", artist: "AI DJ", description: "Text-only.", hashtags: ["#AI"], image: null, count: imageCount });
  }
});
