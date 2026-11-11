# Changelog

## 8.6.0 — 2026-11-11 (professional diagnostics and advisor)
- **Advisor engine** (`src/lib/ops/advisor.ts`):
  - deterministic rules over real data, with no AI cost and no invented numbers;
  - every recommendation has a severity, a category, the evidence (real counts), why it matters, ordered fix steps and a link to the screen where it is fixed.
- **Rules:**
  - Reliability: worker down; disk space (nearest existing folder).
  - Publishing: stalled despite automation; UNKNOWN jobs; failure rate with the top 3 error reasons; kill switch.
  - Content: recurring QC failures mapped to concrete fixes for 16 checks; dry-run; approval backlog; low approval rate; product repetition per account.
  - Growth: story-only accounts; missing metrics; weak Reel hooks (skip rate); zero saves and shares; statistically confirmed patterns; small samples.
  - Cost: month-end budget projection; cost per verified post.
  - Integrations: Veo selected without a key; broken connections; failed Metricool check; dead n8n deliveries.
  - Security: HTTP in production; many admins; autonomous publishing.
- **Health score** 0–100 with grades A–F (critical −25, high −10, medium −4, low −1) and a daily snapshot (06:50) for a 60-day trend.
- **Performance indicators:**
  - designs, QC pass rate, approval rate and publish success rate;
  - verified posts, pending approvals and average engagement;
  - cost per design, cost per verified post, and month spend vs projection.
  - A KPI with no data shows "—", never 0 or 100.
- **New technical checks:** disk free space and database size.
- **Redesigned diagnostics page:**
  - score gauge, severity counts and trend line;
  - KPI tiles;
  - recommendations grouped by category, with high and critical ones open by default;
  - the technical checks table.
- **Elsewhere:** `/api/diagnostics` and the n8n diagnostics endpoint include `advisor`. The n8n morning check adds "today's priorities". `ig-health` / `cli health` print the score and recommendations.
- 172 tests passing.

## 8.5.0 — 2026-11-11 (n8n, professional)
- **Reliability:**
  - `Idempotency-Key` on POST /generate and /decision: a replay returns the first response, and concurrent duplicates get 409.
  - 404 from n8n (workflow inactive or starting) is retried instead of being marked dead. This was found in a live n8n test.
  - Failed events can be resent per event or in bulk from the dashboard.
  - `GET /deliveries?since=` for catch-up.
- **Events:**
  - `ad.rejected`
  - `approvals.reminder`: hourly, once per design that waited longer than N hours
  - `daily.digest`: 21:05 Bahrain
  - `system.alert`: every new warning or error notification is bridged, except codes that have a dedicated event
- **API:**
  - `GET /ads` (signed previews)
  - `GET /ads/{id}`
  - `POST /accounts/{id}/pause` (off by default, audited as `n8n:<user>`)
- **Templates** (regenerated from `deploy/n8n/generate_templates.py`):
  - the events router now de-duplicates by delivery id and formats every event;
  - one Telegram bot handles both buttons and commands (`/pending`, `/status`, `/report`, `/pause`, `/resume`), restricted to allowed users;
  - a new error workflow, set as `errorWorkflow` on all the others;
  - API auth now comes from `.env` (`FC_API_TOKEN`), so no n8n credential is needed for the API.
- **Operations:**
  - n8n execution pruning (14 days; failures kept), proxy hops and file-permission hardening in compose;
  - `backup.sh` includes the n8n volume;
  - diagnostics shows n8n health (dead or delayed deliveries, last success).
- Verified live against n8n 2.35.7: the bot commands against the real API, event formatting, de-duplication of a redelivered event.
- 166 tests passing.

## 8.4.0 — 2026-11-11 (Gemini Veo AI video for Reels)
- **Gemini API / Veo connector** (`src/lib/ai/veo.ts`):
  - image-to-video at 9:16, 4/6/8 s, 720p or 1080p;
  - long-running operation with polling, then an authenticated download;
  - error mapping: AUTH, QUOTA, SAFETY (filtered outputs), TIMEOUT, NETWORK;
  - first-frame image falls back to the alternative REST field format when the API rejects the first one;
  - a free `verify()` that lists the Veo models available to the key.
- **Pipeline:** with `videoEngine = veo`, the AI product scene is the first frame of the Veo clip. The FFmpeg renderer uses the clip as the moving base, adds a contrast shade, the deterministic verified overlays (logo, headline, badge, CTA, both phones) and the 3 s end card, and keeps Veo's native audio (unless music was chosen). The output is a 1080×1920 H.264/AAC MP4. The raw clip is kept as `SOURCE_VIDEO`.
- **Cost controls:** price per second (editable), up-front budget check, a daily Veo limit, and usage recorded as `kind = video`. Dry-run never calls Veo.
- **Fallback:** if Veo fails, an FFmpeg reel is still delivered. It is flagged by the QC warning `ai_video` and a `VEO_FALLBACK` notification, so a substitution is never silent. The fallback can be turned off.
- **UI:**
  - AI settings → Gemini Veo: encrypted key, model, duration, resolution, price, daily limit, native audio, fallback, and a free "verify key & model" button.
  - Create page: a «محرك الفيديو» selector.
- 161 tests passing.
- **Not verified against the live Gemini API:** this environment has no Gemini key, and Google's docs domain is blocked here. Model ids and price are settings for that reason.

## 8.3.0 — 2026-11-11 (Instagram carousels)
- New format `IMAGE_CAROUSEL`. Each post has 5–6 slides at 1080×1350:
  - the designed cover;
  - 3–4 useful content slides, with a large number, title and body on a blurred backdrop of the same product, a vector swipe arrow, and both branch numbers on every slide;
  - a final slide with save & share, the official CTA and both branches.
  - The audit measured zero shares and one save with single images; carousels are the format built for saves and shares.
- The AI brief returns `slides` for carousels. Missing slides are topped up with truthful generic slides (no prices, times or promises). The dry-run preview builds slides from the approved product messages.
- QC blocker `carousel_slides`: 5–10 images, every text fits, no missing glyphs, no overlap. While building this, QC caught that the Arabic font has no "←" glyph, so the arrow is now drawn as a vector.
- Approval binding covers the whole bundle: SHA-256 of the ordered file hashes. The publisher re-hashes every slide; one modified slide blocks publishing.
- Publishing sends all images in order in a single Metricool post (an Instagram carousel). Networks without carousel support are reported as unavailable.
- The growth mix is now 50% Reels, 25% carousels, 15% feed, 10% stories.
- The dashboard shows the slide strip on the design page. The n8n event includes `slideUrls`. The CLI pre-publish check verifies every slide.
- 154 tests passing.

## 8.2.0 — 2026-11-11 (content engine + n8n)
### Content generation
- **Seasonal content planner:** when the occasion is left on automatic, the system picks a timely one:
  - Bahrain National Day, New Year, Mother's Day, graduation, back to school and wedding season;
  - Ramadan and both Eids, using astronomical dates for 2027–2029;
  - Saudi National Day only for the KSA account;
  - Diwali and Onam only for Malayalam/English accounts.
  - Seasonal posts become more frequent near the peak (80% in the last 3 days), so feeds stay varied.
- **Content-angle rotation:** never one of the last 3 angles used on the account. Automatic choices are recorded (`direction.autoPicked`), so analytics can compare them.
- **Caption quality check** (QC WARNING, never blocks): hook ≤ 125 characters, short body, clear CTA, ≤ 5 hashtags, light emoji use. Stored captions keep at most 5 unique hashtags.
### n8n
- Durable, signed (HMAC-SHA256) event outbox with retries. Events:
  - `ad.ready_for_review` (with a signed image link)
  - `ad.approved`
  - `publication.scheduled`
  - `publication.published`
  - `publication.failed`
  - `publication.unknown`
  - `connection.lost`
  - `report.weekly` (Sunday 08:40)
- Token-authenticated inbound API `/api/integrations/n8n/*`:
  - accounts, generate, reports, diagnostics, events;
  - decision (approve/reject), off by default. It uses the same guarded approval with SHA-256 binding.
- Dashboard: n8n settings, one-time secret and token generation (stored encrypted), a test event, and the delivery log.
- Optional `n8n` service in docker-compose on the same server (`--profile n8n`), plus a Caddy route `n8n.<DOMAIN>`.
- 4 importable workflows in `deploy/n8n/`:
  - events → Telegram, with approve/reject buttons;
  - Telegram approvals, restricted to allowed users;
  - morning health check;
  - Google Sheets ideas → designs.
- A test runs the template's own signature code against the server's signing.
- 149 tests passing.

## 8.1.0 — 2026-11-11 (data-driven growth update)
Based on a real Metricool audit of the 15 brands (`docs/ACCOUNT_AUDIT_2026-11.md`):
- **Reel hook opening** (default on): headline, product badge and logo are visible on frame 0, and the first scene opens with a fast punch-in. Measured skip rates were 63–84% with the old slow opening. Covered by a first-frame test.
- **Growth content mix** per account (`formatStrategy = GROWTH_MIX`): 60% Reels, 30% feed, 10% stories, chosen automatically from the last 14 days. Opt-in; existing accounts keep FIXED.
- Default Reel length for new accounts is 10 s (measured average watch time: 3–9 s).
- Caption rules: natural Bahraini Arabic, hook under 125 characters, short body, send-to-a-friend and DM-keyword CTAs, 3–5 hashtags. The Instagram hashtag cap in the publisher is now 5.
- The analytics parser understands the real Metricool fields (`timestamp`, `reelsSkipRate`, `retention`, `durationSeconds`, `follows`, `permalink`). Previously `timestamp` was not read, so time-based matching would have failed.
- Reports show the Reel skip rate and retention, and warn when skips exceed 60% or a period has zero comments and shares.
- 135 tests passing.

## 8.0.0 — 2026-11-11 (V8 Enterprise upgrade)

An incremental upgrade of the existing system. Every V7 feature is kept, the database migration only adds things, and all 129 automated tests pass.

### Publishing reliability (critical fixes first)
- **UNKNOWN submissions are no longer re-sent automatically.** After a search miss, the job stays `UNKNOWN`, an operator is notified, and the decision is theirs:
  - "بحث ثم إعادة الإرسال" (search, then resend) runs a fresh Metricool lookup first.
  - "إلغاء" (cancel) closes the job without sending.
  - The old behaviour is available only through the `publishing.autoResubmitAfterAbsence` setting (off by default).
- **Approval binding:** the SHA-256 of the exact approved media is stored on the approval record. Before every submission the publisher re-hashes the bytes on disk. A file modified or replaced after rendering or approval is refused.
- **Per-account emergency pause** (`SocialAccount.paused`):
  - stops automatic generation (scheduler and campaigns);
  - refuses new publication jobs;
  - holds already-queued submissions without sending them.
  - Controls are in the dashboard, the API (`POST /api/accounts/:id/pause`) and the CLI.
- **Stuck-job detection** now runs every 5 minutes, not only at worker restart. An expired submission lease becomes `UNKNOWN`, which leads to reconciliation, never a blind resend.
- **Worker liveness:** the worker writes a heartbeat to Redis every minute.
- **Structured JSON logs** with correlation IDs (the publication idempotency key) and automatic secret redaction.
- API: a missing record now returns 404 instead of 500.

### Scheduling
- The default publishing interval is now **every 7 hours** per account (`publishIntervalMinutes` 420; `maxDailyAds` 4).
- The migration moves accounts still on the untouched old default (60 min / 24 per day) to the new default. Customised accounts are kept.
- Per-account settings still override the global defaults.

### Quality control and approval
- Explicit QC verdicts are shown on the ad page and in the approval queue:
  - `PASS`
  - `NEEDS_REVIEW`
  - `NEEDS_ASSET`
  - `REJECTED`
- **Request changes:** closes the current version with the note and generates a new revision with the same account, product, format, language and creative direction, plus the note.
- Revision history is shown on the ad page.

### Growth analytics (new)
- Read-only import of Metricool per-post analytics, twice a day plus a manual button. Metrics are matched to provider-verified publications by public URL, or by a unique same-type post within ±20 minutes. Ambiguous matches are skipped, missing metrics stay empty, and manual entries are never overwritten.
- Pattern engine with Welch's t-test across format, posting hour, design style, content type, occasion, category, language and template:
  - `CONFIRMED` only when p < 0.05 and there are at least 5 posts on each side;
  - otherwise `TREND` or `INSUFFICIENT`, with a proposed A/B test and an estimate of the posts needed per variant.
- Weekly and monthly reports per account or for all accounts: the **التقارير والتجارب** page and `GET /api/reports`.

### Operations
- **تشخيص النظام** (system diagnostics) page and `GET /api/diagnostics`. Covers the database, Redis, worker heartbeat, kill switch, mode, OpenAI and Metricool configuration (never secret values), the logo, FFmpeg, accounts and connections, stuck/unknown/overdue/failed jobs, and pending approvals.
- The top bar no longer shows "OpenAI مباشر" (live) when no key is configured.

### Claude Code
- 8 skills in `.claude/skills/`, each backed by the real operator CLI (`scripts/ig/cli.ts`, `scripts/ig/run.sh`):
  - `/ig-command`
  - `/ig-health`
  - `/ig-autodesign`
  - `/ig-video-engine`
  - `/ig-publish-safe`
  - `/ig-recover`
  - `/ig-report`
  - `/ig-experiments`
- A least-privilege `ig-operator` agent (Bash and Read only, CLI only).
- State-changing CLI commands require `--confirm`. Nothing in the CLI submits a post directly.

### Database
- Migration `20261111090000_v8_reliability` adds:
  - `social_accounts.paused`, `pausedReason` and `pausedAt`;
  - new defaults for the interval and daily limit;
  - `approval_requests.mediaSha256`;
  - `publication_results.metricsFetchedAt` and `metricsSource`.

## 7.x — earlier (summary)
- Metricool audit: real best posting hours, story captions, media URLs ending in a file extension, per-network caption limits, alt text, optional first-comment hashtags, hourly connection health check.
- One-click Metricool linking; optional approval for full-AI designs; full-AI poster mode; gold poster template; publishing channels, design type and style, pro reels, reel duration and audio; recurring campaigns; fix for the OpenAI temperature error.
