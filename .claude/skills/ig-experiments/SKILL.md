---
name: ig-experiments
description: Evidence-based A/B testing for Instagram — finds strong/weak creative patterns (format, hour, style, content type, occasion, category, language) with Welch t-tests, flags small samples, and proposes experiments with the posts needed per variant. Use for "what works", "best time", "A/B test".
allowed-tools: Bash(bash scripts/ig/run.sh experiments:*), Bash(bash scripts/ig/run.sh accounts)
---
# /ig-experiments
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

1. `bash scripts/ig/run.sh experiments [accountId]` (last 90 days, verified posts with metrics only).
2. CONFIRMED (p<0.05, ≥5 posts per side) → recommend adopting, as a provisional result.
3. TREND / INSUFFICIENT → propose an A/B experiment: variant A vs B, `postsPerVariant` each, alternate them, everything else held constant. Suggest a recurring campaign from the dashboard (الحملات المتكررة) with the variant as the creative direction.
Never present a TREND as a fact. If samples < 20, lead with that limitation.
