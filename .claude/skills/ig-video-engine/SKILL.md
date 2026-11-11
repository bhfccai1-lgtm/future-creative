---
name: ig-video-engine
description: Real MP4 Reel production and verification — queues a 1080×1920 H.264 Reel (multi-scene motion, transitions, end card, optional synthesized audio) and probes an existing Reel's codec, size, duration and audio with ffprobe. Use for "اعمل ريلز", "is this reel valid".
allowed-tools: Bash(bash scripts/ig/run.sh accounts), Bash(bash scripts/ig/run.sh generate:*), Bash(bash scripts/ig/run.sh probe:*)
---
# /ig-video-engine
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

- Create: `bash scripts/ig/run.sh generate <accountId> REEL_VIDEO "<idea>" --confirm` (after the user agrees). Duration, reel style (standard/pro multi-scene) and audio (none/ambient/upbeat/Instagram licensed audio) are chosen on the dashboard create page.
- Verify: `bash scripts/ig/run.sh probe <adId>` → report codec, resolution, fps, duration, audio, SHA-256 match and any problems.

Honesty: motion is produced with FFmpeg from AI stills (camera moves, transitions, animated text). No generative-video model and no voiceover provider is connected — never describe the output as AI-generated video footage. If `video` is null the ad is a still image, not a Reel.
