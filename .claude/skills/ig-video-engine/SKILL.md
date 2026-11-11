---
name: ig-video-engine
description: Real MP4 Reel production and verification — queues a 1080×1920 H.264 Reel (multi-scene motion, transitions, end card, optional synthesized audio) and probes an existing Reel's codec, size, duration and audio with ffprobe. Use for "اعمل ريلز", "is this reel valid".
allowed-tools: Bash(bash scripts/ig/run.sh accounts), Bash(bash scripts/ig/run.sh generate:*), Bash(bash scripts/ig/run.sh probe:*)
---
# /ig-video-engine
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

- Create: `bash scripts/ig/run.sh generate <accountId> REEL_VIDEO "<idea>" --confirm` (after the user agrees). Duration, reel style (standard/pro multi-scene) and audio (none/ambient/upbeat/Instagram licensed audio) are chosen on the dashboard create page.
- Verify: `bash scripts/ig/run.sh probe <adId>` → report codec, resolution, fps, duration, audio, SHA-256 match and any problems.

Engines:
- **FFmpeg** (free): camera motion and transitions from the AI product still.
- **Gemini Veo** (paid per second, needs a Gemini API key in the dashboard → AI settings → Gemini Veo): real AI video generated from the product scene as its first frame. The system then draws the verified logo, headline, button, both phone numbers and the end card on top.
- Choose the engine per design on the create page («محرك الفيديو»), or set the default in AI settings.

Honesty:
- After generation, check the design's QC item «فيديو ذكاء اصطناعي حقيقي (Gemini Veo)». If it failed, the reel was made with FFmpeg (the reason is shown). Never call an FFmpeg reel "AI-generated video".
- If `video` is null the ad is a still image, not a Reel.
- No voiceover provider is connected.
