---
name: ig-autodesign
description: Commercial design workflow for the Future Creative Instagram accounts — queues real AI-generated, brand-composited designs (official logo layer, Saar/Salmabad phones, Arabic RTL typography, QC) into the approval queue. Use for "صمّم إعلان", "new design for account X".
allowed-tools: Bash(bash scripts/ig/run.sh accounts), Bash(bash scripts/ig/run.sh generate:*), Bash(bash scripts/ig/run.sh preflight:*)
---
# /ig-autodesign
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

1. `bash scripts/ig/run.sh accounts` → pick the account (respect its language: ar / en / ml).
2. Confirm with the user, then: `bash scripts/ig/run.sh generate <accountId> [IMAGE_STORY|IMAGE_FEED|IMAGE_SQUARE] "<idea>" --confirm`.
3. The worker generates: AI brief → AI scene image → deterministic composition (logo + phones as separate layers) → QC → approval queue. Tell the user to review it in «طابور الموافقات»; run /ig-publish-safe on the resulting ad.

Ideas must not contain prices, discounts, stock, reviews or delivery promises (QC rejects them). If OpenAI is not configured the output is a dry-run preview and cannot be published — say so.
For the richer options (content type, market, segment, occasion, style, full-AI poster) use the dashboard page «إنشاء تصميم جديد».
