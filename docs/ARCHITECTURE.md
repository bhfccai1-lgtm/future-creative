# Architecture

```
            ┌───────────── Caddy (HTTPS, HSTS) ─────────────┐
 Browser ──►│  web: Next.js 15 (RTL dashboard + API routes) │──► PostgreSQL 16 (Prisma)
            └──────────────────────┬────────────────────────┘        ▲
                                   │ enqueue (BullMQ)                │
                                   ▼                                 │
                            Redis 7 (AOF) ◄──── worker (tsx) ────────┘
                                                 ├─ hourly cycle (cron 0 * * * *, Asia/Bahrain)
                                                 ├─ generate: AI brief → scene → layers → QC → (video)
                                                 ├─ publish: atomic claim → provider submit
                                                 └─ reconcile (5 min) + nightly retention
                                   media: local volume or S3 (signed, expiring URLs for providers)
```

## Technology choices (and why)
* **One Next.js app plus a separate worker process from the same codebase.** API routes are enough for the dashboard. Long-running work (image generation, FFmpeg, publishing) runs in the worker so web requests stay fast and the worker can restart safely. A separate Fastify service was not justified.
* **BullMQ on Redis** provides durable repeatable jobs (`upsertJobScheduler` with a cron and a timezone) and job-id de-duplication. **Correctness does not depend on Redis**, though. Idempotency and locking live in PostgreSQL:
  * a unique `publication_schedules(accountId, slotAt)`, so a cycle can never plan the same slot twice
  * a unique `publication_jobs.idempotencyKey`, giving one publication request per ad, account and provider
  * an atomic claim `UPDATE … WHERE state='QUEUED'` → `PUBLISHING`, so two workers can never submit the same job
* **Text rendering through libvips/Pango instead of SVG `<text>` or opentype paths.** Pango uses HarfBuzz and FriBiDi, which gives correct Arabic joining, RTL ordering, Malayalam conjuncts, and LRI/PDI isolation for phone digits. `opentype.js` is used only to *check* glyph coverage, so missing characters are caught before rendering.
* **The logo is never generated.** The approved PNG is stored with its SHA-256 fingerprint and re-verified before every render and every publication. It is composited as its own layer with an aspect-preserving resize. QC compares the logo region pixel by pixel against the expected composite.
* **Metricool as the publishing gateway.** It already holds official OAuth authorisations for Instagram, Facebook, TikTok, Threads, YouTube, Pinterest, LinkedIn and X, so the platform never touches social-network passwords. Other official APIs can be added by implementing `PublishingAdapter`.
* **Perceptual hash implemented in-repo** (`src/lib/dedup/phash.ts`, DCT pHash) so the algorithm can be audited and has no native dependency.

## Generation pipeline (`src/lib/pipeline/generate.ts`)
1. Load settings, account and business. Enforce daily limits.
2. Load the approved logo and verify its SHA-256. If missing or tampered, **stop**.
3. Choose a product (`selector.ts`): the account's allow-list, rotation away from the last 3 products, weighting by verified performance, and 20% exploration.
4. Run an up-front budget check for the full estimated cost of the ad.
5. Create the brief with structured outputs (strict JSON schema). Check it for idea or headline duplicates within 30 days. If it duplicates, retry with an extended avoid-list.
6. Generate the scene image with the instruction "no text, logos, numbers, watermarks".
7. Compose the layers deterministically, export JPEG, and render the FFmpeg Reel if the format needs one.
8. Compute pHash and SHA-256, store the media, run QC, and store fingerprints.
9. Route by mode: MANUAL or ASSISTED adds the ad to the approval queue. AUTONOMOUS (global authorisation **and** account authorisation, scheduler-originated, QC publishable) auto-approves it, queues it, and writes an audit entry.

## Publication state machine (`src/lib/publishing/state-machine.ts`)
```
DRAFT → GENERATING → GENERATED → QUALITY_REVIEW → APPROVED → QUEUED → PUBLISHING → SCHEDULED → PUBLISHED
                         ↘FAILED        ↘REJECTED      ↘REJECTED            ↘FAILED / UNKNOWN ↗ (reconcile)
```
* `PUBLISHING → UNKNOWN` covers timeouts, connection resets, 5xx responses and success responses without an id. There is **no automatic resubmission**.
* `UNKNOWN →` reconcile: if the provider has the post, it moves to `SCHEDULED`. If the post is proven absent after a 5-minute grace period, it moves back to `QUEUED`, capped at 3 attempts, then `FAILED`.
* `SCHEDULED → PUBLISHED` happens only when the provider reports every target network as `PUBLISHED`. The `verifiedAt` and public URL are stored.
* A `429` from the provider means "not accepted", so the job returns to `QUEUED` with `Retry-After`.
* On restart, recovery turns stale `PUBLISHING` jobs into `UNKNOWN`. It never resubmits them.

## Data model
There are 23 tables (see `prisma/schema.prisma`): users, roles, businesses, brand_assets, social_accounts, social_connections, product_categories, products, creative_briefs, design_templates, advertisements, media_assets, content_fingerprints, publication_schedules, publication_jobs, publication_attempts, publication_results, approval_requests, ai_generation_jobs, ai_usage, audit_logs, notifications and system_settings. Indexes cover every scheduler, dedup and dashboard query path.

## Data retention (`src/lib/ops/recovery.ts → applyRetention`, nightly 03:30)
* Read notifications older than 90 days are deleted.
* Raw provider responses on attempts older than 180 days are cleared. The attempt rows themselves are kept.
* Content fingerprints older than 400 days are deleted. The duplicate window is 30 days, so this keeps a margin.
* Audit logs, publication results and media are **kept**. Archive them with `scripts/backup.sh`.

## Security model
* Session JWT (HS256, 12 h) in an `httpOnly`, `SameSite=Strict`, `Secure` cookie. Each request re-checks the database for user active status and `sessionVersion`, which allows instant revocation.
* Middleware protects every page and API route. Mutating requests need a matching `x-csrf-token` header and `fc_csrf` cookie, plus a same-origin `Origin`.
* RBAC permissions: `autonomy:authorize`, `killswitch:toggle`, `settings:ai`, and so on.
* Login is rate-limited (10 per 5 minutes per IP, backed by Redis) with account lockout after 5 failures.
* OpenAI and Metricool keys are stored AES-256-GCM encrypted in `system_settings` and never returned to the browser (only the last 4 characters).
* Providers download media through HMAC-signed, expiring `/api/public-media` URLs restricted to the `ads/` prefix. The admin media route requires a session.
* The webhook needs HMAC-SHA256 over `timestamp.body` within 5 minutes. It only *triggers* reconciliation and never sets a state from its payload.
