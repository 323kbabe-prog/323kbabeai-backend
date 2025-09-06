/* ---------------- SSE stream (text+image together -> speak) ---------------- */
app.get("/api/trend-stream", async (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const hb = setInterval(() => res.write(":keepalive\n\n"), 15015);

  send("hello", { ok: true });

  try {
    send("status", { msg: "fetching pick…" });
    const pick = await nextNewestPick();

    send("status", { msg: "generating image…" });
    const prompt = stylizedPrompt(pick.title, pick.artist);
    const imageUrl = await generateImageUrl(prompt);
    if (lastImgErr) send("diag", lastImgErr);

    if (imageUrl) {
      imageCount += 1;

      // 🔑 Emit text + image together
      send("trend", {
        title: pick.title,
        artist: pick.artist,
        description: pick.desc,
        hashtags: pick.hashtags,
        image: imageUrl,
        count: imageCount
      });

      // ✅ Cue TTS AFTER text+image are shown
      const speakText = `${pick.title} by ${pick.artist}. ${pick.desc}`;
      send("speak", { text: speakText, artist: pick.artist });

      send("status", { msg: "done" });
      send("end", { ok: true });
    } else {
      send("status", { msg: "image unavailable." });
      send("end", { ok: false });
    }
  } catch (e) {
    send("status", { msg: `error: ${e?.message || e}` });
    send("end", { ok: false });
  } finally {
    clearInterval(hb);
    res.end();
  }
});