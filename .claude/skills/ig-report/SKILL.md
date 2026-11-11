---
name: ig-report
description: Verified weekly or monthly Instagram performance report per account or for all 15 accounts — publishing outcomes, imported Metricool metrics, top/bottom posts, failures and cautious recommendations. Use for "تقرير", "how did we do this week", "monthly results".
allowed-tools: Bash(bash scripts/ig/run.sh report:*), Bash(bash scripts/ig/run.sh accounts)
---
# /ig-report
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

- All accounts: `bash scripts/ig/run.sh report week` (or `month`).
- One account: get its id from `bash scripts/ig/run.sh accounts`, then `bash scripts/ig/run.sh report week <accountId>`.

Summarise in Arabic: posts confirmed, posts with metrics, reach/views/saves/shares, average engagement, top 3, failures, recommendations.
Honesty rules: only numbers present in the JSON; if `withMetrics` is 0 say so; keep the small-sample warning; never promise views or growth.
