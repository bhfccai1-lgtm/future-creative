---
name: ig-publish-safe
description: Read-only pre-publication gate for one design — kill switch, account pause, dry-run, QC verdict, logo fingerprint, media SHA-256 integrity, approval binding and Metricool permission. Use before approving or scheduling, or when asked "can this be published?".
allowed-tools: Bash(bash scripts/ig/run.sh preflight:*)
---
# /ig-publish-safe
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

`bash scripts/ig/run.sh preflight <adId>` (the id is in the dashboard URL /ads/<adId>).

- READY means every gate passed — it does NOT publish anything. Approval/scheduling is done by a human in the dashboard (اعتماد / نشر الآن), or by the scheduler for accounts the admin explicitly authorised.
- BLOCKED: list each failed check with the fix (regenerate after a logo change or tampered file, reconnect the account, resume a paused account, disable dry-run with a real OpenAI key).
Never publish from this skill and never bypass a failed check.
