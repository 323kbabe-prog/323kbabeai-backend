let lastSongs = [];
let bannedSongs = ["Paint The Town Red"]; // avoid sticky repeats

async function nextNewestPick() {
  try {
    // Step 1: Ask GPT for trending song + metadata
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 1.0,
      messages: [
        { role: "system", content: "You are a music trend parser following TikTok, Spotify, and YouTube Shorts trends." },
        { 
          role: "user", 
          content: `Pick ONE real trending song that is viral right now. 
          Avoid repeats from recent picks: ${JSON.stringify(lastSongs)}. 
          Do not include banned songs: ${JSON.stringify(bannedSongs)}. 
          Reply ONLY as JSON { "title": "...", "artist": "...", "lens": "...", "genre": "...", "community": "..." }.
          Rules:
          - title = exact song name (real, not invented).
          - artist = real performer.
          - lens = short phrase (e.g. TikTok dance, remix, meme, duet).
          - genre = real musical style (e.g. K-pop, hip hop, EDM).
          - community = who is pushing it viral (e.g. Latino TikTok, Black hip hop fans, K-pop stans).
          Do not include "unknown", "omg", "idk". Only valid JSON.`
        }
      ]
    });

    let pick;
    try {
      pick = JSON.parse(completion.choices[0].message.content || "{}");
    } catch {
      pick = { 
        title: "Fresh Drop", 
        artist: "AI DJ", 
        lens: "viral energy", 
        genre: "mixed", 
        community: "global fans" 
      };
    }

    // Step 2: Generate description using GPT with lens/genre/community context
    let descOut = "";
    try {
      const desc = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 1.0,
        messages: [
          { role: "system", content: "Write like a Gen-Z fan describing why a viral song is blowing up." },
          { 
            role: "user", 
            content: `Write a 60-80 word first-person description of "${pick.title}" by ${pick.artist}. 
            Lens: ${pick.lens}. 
            Genre: ${pick.genre}. 
            Community: ${pick.community}. 
            Use a Gen-Z casual fan voice. 
            Do not use filler like "omg", "unknown", or "idk".`
          }
        ]
      });
      descOut = desc.choices[0].message.content.trim();
    } catch {
      descOut = "This track is buzzing everywhere right now.";
    }

    // Step 3: update history
    lastSongs.push({ title: pick.title, artist: pick.artist });
    if (lastSongs.length > 5) lastSongs.shift();

    return {
      title: pick.title || "Unknown",
      artist: pick.artist || "Unknown",
      lens: pick.lens || "",
      genre: pick.genre || "",
      community: pick.community || "",
      desc: descOut,
      hashtags: ["#NowPlaying", "#TrendingNow", "#AIFavorite"]
    };
  } catch (e) {
    return {
      title: "Fallback Song",
      artist: "AI DJ",
      lens: "viral energy",
      genre: "mixed",
      community: "global fans",
      desc: "Couldn’t fetch the latest trend — but this track still sets the vibe.",
      hashtags: ["#AITrend"]
    };
  }
}
