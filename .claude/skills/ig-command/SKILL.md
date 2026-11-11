---
name: ig-command
description: Unified operations entry point for FUTURE CREATIVE INSTAGRAM AI — routes a request to health, accounts, design, reel, preflight, recovery, report or experiments, and handles per-account emergency pause/resume with consent. Use when the request is general ("شغّل النظام", "وضع الحسابات", "أوقف حساب").
allowed-tools: Bash(bash scripts/ig/run.sh:*)
---
# /ig-command
Run commands through `bash scripts/ig/run.sh <command>` — it uses `docker compose exec -T worker` on the server and plain `npx tsx` in development.

Routing:
| Request | Command / skill |
|---|---|
| status, problems | `health` → /ig-health |
| list accounts | `accounts` |
| new design | /ig-autodesign |
| reel | /ig-video-engine |
| can it be published | `preflight <adId>` → /ig-publish-safe |
| unknown/stuck/failed | `recover list` → /ig-recover |
| results | `report week|month [accountId]` → /ig-report |
| what works | `experiments [accountId]` → /ig-experiments |
| emergency stop one account | `pause <accountId> <reason> --confirm` / `resume <accountId> --confirm` |

State-changing commands (`generate`, `pause`, `resume`, `recover resubmit|cancel|sweep`) need the user's explicit agreement first, then `--confirm`.
The global kill switch, autonomous-publishing authorisation and API keys are changed only by an admin in the dashboard — never from here. Never print secrets; never claim a post is published unless its state is PUBLISHED (provider-verified).
