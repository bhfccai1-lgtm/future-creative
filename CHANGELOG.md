# Changelog

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
