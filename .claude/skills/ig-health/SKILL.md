---
name: ig-health
description: Diagnose the Future Creative publishing system and its 15 Instagram accounts — services, worker heartbeat, Metricool/OpenAI configuration (never values), logo, stuck/unknown/failed jobs. Use when asked "is the system OK", "why didn't it post", or before any publishing work.
allowed-tools: Bash(bash scripts/ig/run.sh health), Bash(bash scripts/ig/run.sh accounts)
---
# /ig-health
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

1. Run `bash scripts/ig/run.sh health` (exit code 1 = at least one FAIL).
2. If accounts matter, run `bash scripts/ig/run.sh accounts`.
3. Report in Arabic: overall status, each FAIL/WARN with its "→" corrective action, in that order of severity.

Rules: never print or ask for secrets; a configured key is reported only as "مُعدّ". Do not "fix" anything from this skill — it is read-only. Point to /ig-recover for UNKNOWN or stuck jobs.
