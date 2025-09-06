<script>
document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = "https://three23kbabeai-backend.onrender.com"; 
  const voicePlayer = new Audio();

  const t=document.getElementById("r-title"),
        a=document.getElementById("r-artist"),
        d=document.getElementById("r-desc"),
        g=document.getElementById("r-tags"),
        c=document.getElementById("r-count"),
        img=document.getElementById("r-img"),
        fb=document.getElementById("r-fallback"),
        voiceStatus=document.getElementById("voice-status"),
        logEl=document.getElementById("log"),
        overlay=document.getElementById("loading-overlay");

  function ts(){return new Date().toLocaleTimeString([], {hour12:false});}
  function line(msg){const p=document.createElement("p");p.innerHTML=`<span>[${ts()}]</span> ${msg}`;logEl.appendChild(p);logEl.scrollTop=logEl.scrollHeight;}
  function info(m){line(m);}function ok(m){line(m);}function err(m){line(m);}

  async function loadTrend(){
    try{
      info("📡👀💫 323kbabe scanning vibes rn 🎶✨🌈🦄🔥");
      overlay.style.display = "flex";
      setTimeout(()=>overlay.style.opacity="1", 10);

      const r=await fetch(`${API_BASE}/api/trend?style=stan-photocard`,{cache:"no-store"});
      const j=await r.json();

      // 🔥 wrap everything in emojis
      t.textContent = `🎶✨🌈 ${j.title?.toLowerCase()||"untitled"} 💿🔥💖`;
      a.textContent = `👩‍🎤💎 ${j.artist?.toLowerCase()||"unknown"} 🌸🎤✨`;
      d.textContent = `💖🔥🦋 ${j.description?.toLowerCase()||""} 🌍✨🎶💅`;

      g.innerHTML=(j.hashtags||[]).slice(0,3).map(x=>
        `<span class="badge">✨${String(x).toLowerCase()}🔥</span>`).join("");

      if(typeof j.count==="number")c.textContent="images dropped: "+j.count;
      if(j.image){
        img.src=j.image; img.style.display="block"; fb.style.display="none";
        ok("🌈✨🦋🔥🖼️💿 image ready babe 💅💖🌸🌍");
      } else {
        img.style.display="none"; fb.style.display="block";
      }
      if(j.description) playVoice(j.description, j.artist);

    }catch(e){
      err("💔⚠️🚨😵❌ fetch flopped… retry soon 😭🔥🪐");
    }finally{
      overlay.style.opacity = "0";
      setTimeout(()=>overlay.style.display="none", 300);
    }
  }

  async function playVoice(text, artist){
    try{
      voiceStatus.textContent="🎤🔊✨ ai voice loading…";
      const url=`${API_BASE}/api/voice?text=${encodeURIComponent(text)}&artist=${encodeURIComponent(artist||"")}`;
      voicePlayer.src=url;
      await voicePlayer.play();
      ok("🎤🎶💖🔊✨ sweet ai voice on air 💅🌸🔥");
      voicePlayer.onended=()=>{
        voiceStatus.textContent="";
        setTimeout(loadTrend, 3000);
      };
    }catch(e){
      err("🔇😢💔😭💤 voice broke… silence vibes rn 😔✨");
      voiceStatus.textContent="";
      setTimeout(loadTrend, 3000);
    }
  }

  document.getElementById("start-btn").addEventListener("click",()=>{
    document.getElementById("start-screen").style.display="none";
    document.getElementById("app").style.display="block";
    loadTrend();
    overlay.style.pointerEvents="auto";
  });
});
</script>
