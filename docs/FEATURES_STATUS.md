# Implemented vs. not implemented

Legend: ✅ implemented and covered by automated tests · 🟡 implemented, but needs live credentials or manual verification · ❌ not implemented

## Core
| Feature | Status | Notes |
|---|---|---|
| Arabic RTL dashboard (15 sections + ad detail + login) | ✅ | Built with `next build`. End-to-end browser run: login, logo upload and approval, image generation, Reel generation, CSRF rejection. |
| Auth, RBAC (ADMIN/EDITOR/VIEWER), lockout, rate limit, CSRF, secure cookies | ✅ | No UI for user management yet: create users with `npm run admin:create`. Additional roles are seeded but have no management screen ❌ |
| Encrypted secrets (AES-256-GCM), never sent to the browser | ✅ | |
| Brand settings: logo upload, validation (PNG, alpha, real transparency), SHA-256, approval, preview | ✅ | |
| Generation blocked when the logo is missing or its fingerprint mismatches; publication blocked if the logo changed after rendering | ✅ | |
| Product catalog (32 seeded products in 11 categories, AR/EN/ML titles) with unlimited additions and activate/deactivate | ✅ | No edit form for existing products' text in the UI (API `PATCH /api/products/:id` exists) 🟡. Malayalam titles should be reviewed by a native speaker 🟡 |
| Accounts: independent settings, 15 Instagram slots seeded, provider-verified connect, per-account disconnect, auto-publish switch, autonomous authorisation | ✅ | |
| Token expiry / insufficient permission detection | ✅ | Detected from `tokenExpiresAt` and provider 401/403. Metricool manages the underlying OAuth tokens. |

## AI and design
| Feature | Status | Notes |
|---|---|---|
| OpenAI structured-output creative brief (strict JSON schema) | 🟡 | Code complete, with error mapping (auth, billing, rate limit, policy). **Not executed against the real API**, because no key was available. |
| OpenAI image generation (`images.generate`, b64) | 🟡 | Same as above. |
| Provider abstraction plus offline dry-run provider | ✅ | Dry-run ads are flagged and can never be published. |
| 7-layer deterministic composition, Arabic shaping, auto-fit, glyph coverage, contrast, overlap and logo-pixel QC | ✅ | 2 templates (navy/gold classic, gold-frame lower). 4 formats: 1080×1920, 1080×1350, 1080×1080, and Reel. |
| Real FFmpeg Reels with validation | ✅ | Motion is camera push-in plus animated overlays on the AI still. It is not generative video: no AI video model is used ❌ |
| Proofreading | 🟡 | Deterministic typographic lint, plus human approval in MANUAL/ASSISTED modes. **There is no dictionary spell-checker**, and AI review (`useAiReview`) exists as a setting but is not wired ❌ |
| Unverifiable-claims detection (prices, discounts, delivery times, superlatives in AR/EN/ML) | ✅ | Pattern-based. |
| Duplicate prevention (SHA-256, pHash, headline, idea, product+occasion; per account and cross-account) | ✅ | Idea similarity is lexical (token and trigram Jaccard), not embedding-based. |
| Performance-weighted product selection | ✅ / 🟡 | The selection logic is tested. Engagement metrics come from manual entry (`PUT /api/results/:id`); **automatic analytics import from Metricool is not implemented** ❌ |

## Scheduling and publishing
| Feature | Status | Notes |
|---|---|---|
| Hourly scheduler (Asia/Bahrain), Mode A / Mode B, windows, intervals, daily limits, idempotent slots | ✅ | |
| BullMQ durable jobs, atomic claim, idempotency keys, restart recovery | ✅ | |
| MANUAL / ASSISTED / AUTONOMOUS modes, approval queue, publish now, kill switch, audit log | ✅ | |
| Metricool adapter: brands, create scheduled post, status, reconcile search | 🟡 | Body schema aligned with Metricool. **Paths and response parsing must be verified with a real account** (see `CONFIG_OPENAI_METRICOOL.md`). |
| UNKNOWN reconciliation, bounded re-queue, SCHEDULED→PUBLISHED only on confirmation | ✅ | Tested with a mocked provider only. |
| Provider rate limiting (shared limiter plus 429 handling) | ✅ | |
| Creating drafts in Metricool | ❌ | The system keeps its own approval queue. All provider posts are created with `draft:false` after approval. |
| Direct official platform adapters (Meta Graph, TikTok, YouTube, LinkedIn, Pinterest, X) | ❌ | `PublishingAdapter` interface ready; not implemented. |
| Signed webhook to trigger reconciliation | ✅ | Generic HMAC endpoint. Metricool does not need to call it, because polling every 5 minutes covers the same ground. |
| Google Drive archive | ❌ | Not implemented. Use `scripts/backup.sh` with rclone. |

## Operations
| Feature | Status | Notes |
|---|---|---|
| Notifications/alerts page, failed/unknown overview, audit-log viewer | ✅ | Alerts appear in the dashboard; **no email/SMS delivery** ❌ |
| Cost tracking, monthly cap (up-front and per call), threshold alerts, daily limits, cost reports | ✅ | |
| Docker Compose (Postgres, Redis, migrate+seed, web, worker, Caddy HTTPS, optional MinIO) | 🟡 | `docker compose config` validated. `docker build` could not finish in the dev sandbox (no network for npm inside the build); **not yet built or run**. |
| Backups / restore scripts, data retention job | ✅ / 🟡 | Scripts written; **restore not exercised in this environment**. |
| Health endpoint, log rotation | ✅ | |
