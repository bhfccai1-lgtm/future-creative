# FUTURE CREATIVE AI PUBLISHING SYSTEM v9
[![CI](https://github.com/bhfccai1-lgtm/future-creative/actions/workflows/ci.yml/badge.svg)](https://github.com/bhfccai1-lgtm/future-creative/actions/workflows/ci.yml) [![CodeQL](https://github.com/bhfccai1-lgtm/future-creative/actions/workflows/codeql.yml/badge.svg)](https://github.com/bhfccai1-lgtm/future-creative/actions/workflows/codeql.yml) [![Release](https://img.shields.io/github/v/release/bhfccai1-lgtm/future-creative)](https://github.com/bhfccai1-lgtm/future-creative/releases)

> **Server update:** `bash scripts/update.sh` — it checks the GitHub CI result of the new version itself and refuses a red one. What changed: [CHANGELOG.md](CHANGELOG.md) · [Releases](https://github.com/bhfccai1-lgtm/future-creative/releases).
**مطبعة إبداع المستقبل — Future Creative Printing (Bahrain)**

A self-hosted platform that plans, designs, quality-checks, schedules and publishes printing-service advertisements to many social accounts. The dashboard is Arabic and right-to-left. Ads can be produced in Arabic, English or Malayalam. All scheduling runs on Asia/Bahrain time.

> **Status:** in production on the owner's server. Every push runs typecheck, unit and integration tests (PostgreSQL + Redis), the production build and the Docker image build in GitHub Actions.
> **Live publishing has not been verified.** No real OpenAI key or Metricool account was available during development. Follow `docs/PRODUCTION_CHECKLIST.md` before enabling it.

## What it does
| Area | Implementation |
|---|---|
| AI creative director | Picks the product with rotation plus a performance weighting. Asks OpenAI for a structured JSON creative brief. Rejects ideas or headlines that repeat within 30 days on the same account. Generates the scene image, which contains **no text and no logo**. |
| Design engine | Assembles each ad from 7 separate, deterministic layers with Sharp and libvips/Pango (HarfBuzz shaping, FriBiDi): scene, headline, supporting copy, the **original logo** (resized only, SHA-256 verified), Saar 33316319, Salmabad 34315316, and the CTA "اطلب الآن". Text shrinks to fit its box. Overflow, missing glyphs, overlaps, low contrast and logo tampering are all detected. |
| Video | Builds real FFmpeg MP4 Reels at 1080×1920, H.264/AAC: camera push-in, animated text and an end card. Output is validated with ffprobe. A failed render is reported and never replaced with a still image. |
| Quality control | 19 deterministic checks: logo fingerprint and pixel integrity, phone numbers, language and script, typographic lint, price/discount/delivery claims, layout fit, contrast, dimensions, format, duplicates, video validity, and dry-run blocking. |
| Duplicate prevention | Checks file SHA-256, perceptual hash (DCT pHash), normalised headline, idea similarity and product+occasion, per account. Also blocks the same creative from going to several accounts. |
| Scheduler | BullMQ wakes it every hour (Asia/Bahrain). **Mode A:** each account publishes on its own interval. **Mode B:** N posts per hour across selected accounts. It plans the next hour's slot, is idempotent through a unique `(account, slot)` constraint, and respects publishing windows, daily limits and existing scheduled posts. |
| Publishing | Metricool adapter behind a `PublishingAdapter` interface. Jobs are claimed atomically and carry idempotency keys. Uncertain results move to **UNKNOWN** and are reconciled with the provider before any retry. **PUBLISHED is set only after the provider confirms it.** |
| Safety | Starts in MANUAL mode with auto-publishing off. Autonomous mode needs a global authorisation (typed confirmation) **and** per-account authorisation. There is a global kill switch, and every action is written to the audit log. |
| Cost control | Monthly USD cap, checked up front for the whole ad, plus per-call checks. Daily and per-account limits. Token and image cost tracking with an alert threshold. An offline dry-run mode makes no API calls and costs nothing. |
| Security | Login with bcrypt, lockout and rate limiting. HS256 sessions with server-side revocation. RBAC with ADMIN/EDITOR/VIEWER roles. CSRF protection (double-submit token plus Origin check). AES-256-GCM encrypted secrets. HMAC-signed expiring media URLs. A signed webhook endpoint, security headers and an audit log. |

### Added in v9 (sales, growth, real work)
| Area | Implementation |
|---|---|
| Customers & orders | `/leads`: comment inquiries become leads automatically; manual phone / WhatsApp / walk-in leads with the account that brought them; pipeline with follow-ups, order value, lost reasons; orders and value per account. |
| Sales playbook | Next best step per customer with a ready WhatsApp message (human-sent via wa.me), logged; owner-priced, numbered, printable branded quotes; monthly target with pace; past-customer reactivation. |
| Growth | Real Metricool analytics per account, smart posting plan (rhythm + format mix), 30-day growth program with diagnosis, targets, weekly phases followed by the designer, weekly notes. |
| Real work | `/portfolio`: branded posts from real photos of delivered jobs, no AI image, client named only with consent. |

## Contributing / workflow
- Open an issue with the Arabic forms (bug, feature, design problem). Security problems: private advisory (see `SECURITY.md`).
- Every change runs CI; `ci-ok` must be green before the server updates.
- Releases: add a `## X.Y.Z — date` section to `CHANGELOG.md`, set `version` in `package.json`, then publish the release on GitHub. With `bash scripts/autoupdate.sh on` the server installs each release by itself — see [`docs/RELEASES.md`](docs/RELEASES.md).

## Quick start (development)
```bash
cp .env.example .env            # set DATABASE_URL, REDIS_URL, APP_ENCRYPTION_KEY, SESSION_SECRET
npm ci
npx prisma migrate deploy && npm run db:seed
ADMIN_EMAIL=you@example.bh ADMIN_PASSWORD='Strong-Pass-2026' npm run admin:create
npm run build && npm start      # dashboard  → http://localhost:3000
npm run worker                  # scheduler, generation, publishing worker (separate terminal)
npm test                        # unit + integration (integration needs Postgres DB "fcap_test" + Redis)
npx tsx scripts/render-preview.ts ./data/previews [logo.png]   # offline design previews
```
For production, follow **`docs/DEPLOYMENT_UBUNTU.md`**, which uses Docker Compose with PostgreSQL, Redis, web, worker and Caddy HTTPS.

## Documentation
| File | Content |
|---|---|
| `docs/ar/ADMIN_GUIDE_AR.md` | **دليل المسؤول بالعربية** |
| `docs/DEPLOYMENT_UBUNTU.md` | Ubuntu 24.04 deployment, HTTPS, backups, upgrades |
| `docs/CONFIG_OPENAI_METRICOOL.md` | OpenAI and Metricool configuration |
| `docs/ARCHITECTURE.md` | Architecture, technology choices, state machine, data model, retention |
| `docs/FEATURES_STATUS.md` | Implemented vs. not implemented, with honest caveats |
| `docs/TEST_EVIDENCE.md` | Test runs that were actually executed, with output |
| `docs/PRODUCTION_CHECKLIST.md` | Checklist for activating live publishing |

## Tech stack
Next.js 15 (App Router, TypeScript), Tailwind CSS with shadcn-style components, PostgreSQL 16 with Prisma 6, Redis 7 with BullMQ 5, Sharp/libvips/Pango, FFmpeg, the OpenAI SDK, Docker Compose and Caddy. The bundled fonts are Cairo and Noto Sans Malayalam (SIL OFL 1.1, commercial use allowed); licences are in `assets/fonts`.
