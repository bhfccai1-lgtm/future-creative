---
name: ig-recover
description: Safe reconciliation of failed, stuck or UNKNOWN Instagram publications. Lists problem jobs; resubmits only after a fresh Metricool lookup proves the post is absent, and only with operator consent. Use when a post is "غير مؤكد", stuck, or failed.
allowed-tools: Bash(bash scripts/ig/run.sh recover list), Bash(bash scripts/ig/run.sh recover:*)
---
# /ig-recover
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

1. `bash scripts/ig/run.sh recover list` — shows stuck PUBLISHING count and UNKNOWN/FAILED jobs (7 days).
2. For each UNKNOWN job, tell the user to check the brand's planner in Metricool for that time slot.
3. Only after the user explicitly agrees:
   - `bash scripts/ig/run.sh recover resubmit <jobId> --confirm` — runs a fresh provider lookup first; FOUND = adopted (no duplicate), REQUEUED = proven absent and sent again by the worker.
   - `bash scripts/ig/run.sh recover cancel <jobId> --confirm` — closes without sending.
   - `bash scripts/ig/run.sh recover sweep --confirm` — moves expired submission leases to UNKNOWN (never resends).
Never resubmit in a loop, never resubmit FAILED jobs from here (regenerate instead), never claim "published" unless the job state is PUBLISHED.
