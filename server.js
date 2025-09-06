// app.js — two-page flow: Page1 start screen, Page2 content
(() => {
  const $ = (id) => document.getElementById(id);

  const page1   = $("page1");
  const page2   = $("page2");
  const elDot   = $("health-dot");
  const elStatus= $("status");
  const elTitle = $("r-title");
  const elArtist= $("r-artist");
  const elDesc  = $("r-desc");
  const elTags  = $("r-tags");
  const elImg   = $("r-img");
  const elStart = $("start");
  const voiceEl = $("voice");
  const elHead  = $("headline");
  const logbox  = $("logbox");

  let started   = false;
  let autoCycle = true;
  let loading   = false;
  let countdownTimer = null;

  /* Mini log */
  function ts(){ return new Date().toLocaleTimeString([], {hour12:false}); }
  function log(text){
    const lines = logbox.textContent ? logbox.textContent.split("\n") : [];
    lines.push(`[${ts()}] ${text}`);
    while(lines.length > 120) lines.shift();
    logbox.textContent = lines.join("\n");
    logbox.scrollTop = logbox.scrollHeight;
    elHead.textContent = `Log: ${text}`;
  }

  /* Helpers */
  const setStatus = (msg) => { elStatus.textContent = msg; };
  const setDot = (ok) => { elDot.classList.toggle("ok", !!ok); elDot.classList.toggle("err", !ok); };

  async function health(){
    try {
      const r = await fetch("/health",{cache:"no-store"});
      setDot(r.ok); log(r.ok ? "health ✓" : "health ✗");
    } catch { setDot(false); log("health ✗ (network)"); }
  }

  function speak(description, artist){
    const q = new URLSearchParams({ text: description || "", artist: artist || "" });
    voiceEl.src = `/api/voice?${q.toString()}`;
    voiceEl.play().catch(err=>{
      log(`tts play failed: ${err?.message||err}`);
      setStatus("❌ Voice play failed — tap Start.");
    });
  }

  async function fetchTrendOnce(){
    if(loading) return;
    loading = true;
    clearInterval(countdownTimer);
    setStatus("📡 Fetching trend…");
    log("fetch: /api/trend");
    try {
      const r = await fetch("/api/trend",{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      log("fetch ✓");

      // Fill text
      elTitle.textContent  = data.title || "—";
      elArtist.textContent = data.artist || "—";
      elDesc.textContent   = data.description || "—";
      elTags.innerHTML     = "";
      (data.hashtags||[]).forEach(tag=>{
        const span=document.createElement("span");
        span.className="tag"; span.textContent=tag;
        elTags.appendChild(span);
      });

      // Wait for image, then voice
      elImg.onload=()=>{
        log("image loaded ✓");
        setStatus("🖼️ + 🎵 Drop ready");
        if(started) speak(data.description,data.artist);
      };
      elImg.onerror=()=>{
        log("image error ✗");
        setStatus("⚠️ Image failed, but voice starts");
        if(started) speak(data.description,data.artist);
      };
      elImg.src=data.image||"";
    }catch(e){
      setStatus("❌ Error fetching trend.");
      log(`fetch ✗ ${e?.message||e}`);
    }finally{ loading=false; }
  }

  /* Page switch: Start button */
  elStart.addEventListener("click",async()=>{
    started=true;
    page1.style.display="none";
    page2.style.display="block";
    log("start: voice unlocked");
    await fetchTrendOnce();
  });

  /* Auto cycle */
  voiceEl.addEventListener("ended",()=>{
    log("tts: ended");
    if(!autoCycle) return;
    let secs=3;
    setStatus(`⏳ Next in ${secs}s…`);
    countdownTimer=setInterval(()=>{
      secs--;
      setStatus(`⏳ Next in ${secs}s…`);
      if(secs<=0){
        clearInterval(countdownTimer);
        if(started) fetchTrendOnce();
      }
    },1000);
  });

  voiceEl.addEventListener("play",()=>{ setStatus("🔊 Playing…"); log("tts: play"); });
  voiceEl.addEventListener("error",()=>{ setStatus("❌ Voice error."); log("tts: error"); });

  // initial
  page1.style.display="flex";
  health(); setInterval(health,30000);
})();
