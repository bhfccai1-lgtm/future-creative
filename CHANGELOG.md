# Changelog

## 8.14.1 — 2026-11-12 (Google Drive and Sheets from the dashboard)
- The n8n settings take the **Drive archive folder link** and the **Google Sheets link**, stored as their IDs.
- `scripts/n8n-setup.sh` writes them to `.env` as `GDRIVE_FOLDER_ID` and `GSHEET_ID`, so nothing has to be typed in the console.
- Templates 04 (ideas) and 06 (archive) read the sheet from `$env.GSHEET_ID`, so the sheet no longer has to be picked by hand in n8n.

## 8.14.0 — 2026-11-12 (occasions calendar)
- New page **«تقويم المناسبات»** (occasions calendar).
  - It shows the Bahraini and Gulf occasions of the next 5 months, each with its peak date, a countdown, its publishing window and suggested categories.
  - **«إنشاء حملة لهذه المناسبة»** (create a campaign for this occasion) creates a campaign in one click:
    - it runs from the start of the window to one day after the peak, daily at the best time;
    - format, style and method are set to auto;
    - the category is optional;
    - accounts are filtered by market (Saudi occasions → the Saudi account).
- **New occasions:**
  - **القرقاعون** (Gergaoon, 15 Ramadan);
  - **يوم المرأة البحرينية** (Bahraini Women's Day, 1 Dec);
  - **يوم المعلم** (Teachers' Day, 5 Oct).
- 2026 lunar dates were added.
- Fix: a Saudi-market account now gets the Saudi dialect for its voice-over, not the Bahraini one. The market mapping was wrong.

## 8.13.2 — 2026-11-12 (recommended one-click setup)
- New card on the schedule page: «⭐ الإعداد الموصى به» (recommended setup).
  - A preview comes first, then one click applies it to every account: every 7 hours (daily cap 4), smart format variety, and niche categories matched to the account name.
  - Name matches: mugs, education, gifts, stickers, business, occasions, advertising, india.
  - Main-brand and branch accounts keep all products.
  - Accounts that already have chosen categories or products are not changed. The action is audited.

## 8.13.1 — 2026-11-12 (minimum gap between posts)
- **At least 30 minutes between any two posts on the same account**, set by `publishing.minGapMinutes`.
  - The rule applies whatever created the post: a campaign, the automatic schedule or a manual publish.
  - The slot is chosen under a per-account PostgreSQL advisory lock, so simultaneous requests cannot pick the same minute.
  - A queue-delayed post that is moved forward also keeps the gap.
  - A failed post frees its slot.
  - A moved post is audited with `requestedFor` and `movedForGap`.
- Found live in Metricool: bhfcc.mugs had two stories at 19:01.

## 8.13.0 — 2026-11-12 (Bahraini and multilingual voice-over)
- **23 speaker personas** in 12 groups:
  - commercial announcers, female, male, youth;
  - children: pitch and formant shift with rubberband;
  - elderly: slower and deeper;
  - broadcasters, sports commentator, hakawati storyteller, theatrical, comedy, folk, documentary narrator.
- **73 languages and dialects** in 19 audience groups:
  - **Bahraini is the default.** It has accent instructions: ق pronounced as "g", Gulf intonation, Bahraini vocabulary.
  - Other Gulf and Arab dialects, plus Indian, Pakistani, Bangladeshi, Filipino, Nepali, Sri Lankan, African, European, Russian/Eurasian, Turkish, Iranian, Chinese, Japanese, Asian, Latin, American, Canadian and Australian varieties.
  - Each entry carries an honest expected-quality label.
- **Native script per reel:** the AI writes the voice-over in the chosen dialect, sized to the reel length and faithful to the verified copy.
  - Digits, links and hashtags are removed. A script with price or claim language is rejected, and the verified copy is spoken instead.
- **«تلقائي» (auto):**
  - the persona follows the product category and rotates (e.g. sports → commentator, kids → child voices, weddings → elegant female);
  - the dialect follows the audience or market.
- **«استماع لعينة» (listen to a sample)** in the AI settings: a real sample for any persona × dialect (≈ $0.003).
- Every reel records the persona, dialect and spoken script.

## 8.12.0 — 2026-11-12 (professional reel video and sound)
- **Video quality:**
  - camera moves with cosine easing;
  - lanczos upscaling;
  - cinematic transitions only (fade, smooth, fade-black) and a new "slow rise" move;
  - text slides in with cubic ease-out.
- **Mastering:**
  - BT.709 colour tagging and conversion, so colours are no longer washed out on phones;
  - light sharpening, debanding and a fine temporal grain;
  - x264 CRF 17 `slow`, aq-mode 3, capped at 8 Mb/s.
- A short Veo clip is slowed gently (up to 1.25×) instead of freezing before the end card.
- **Sound:**
  - all audio is 48 kHz, 192 kb/s, normalised to −14 LUFS;
  - **licensed music library:** upload with a required licence note and mood. Tracks rotate least-recently-used, and the mood follows the design style;
  - **AI voice-over** (OpenAI TTS, 5 voices) reads only the verified headline, badge, line and CTA (no digits or links), with automatic music ducking;
  - **sound design:** hook impact, whoosh before each transition, text pops, end-card chime.
  - Silent and Instagram-audio reels stay silent.
- The default reel audio is a setting (`ai.audio.defaultReelAudio`, default: upbeat).
- Every reel records the track, its licence and the voice script.
- Migration `20261112120000_audio_library` (additive).

## 8.11.0 — 2026-11-11 (varied professional designs, campaign category, «تلقائي»)
- **Art-direction engine:** every design gets a professional recipe: composition × lighting × lens, plus the poster layout for full-AI posters.
  - The recipe rotates per account (least recently used of the last 12), so consecutive designs differ in angle, light, setting and layout.
  - The recipe is recorded on the ad.
- Full-AI posters now use **6 layout families**: centred badge, split, oversized type, framed card, diagonal, editorial.
  - Their decoration follows the chosen colour theme instead of always navy.
- The brief no longer forces the same table and bokeh. It asks for a specific setting and props each time, with stricter product-accuracy wording.
- **Campaigns:**
  - «تلقائي» (auto) for format (growth mix), idea, design style (rotation) and design method;
  - a **product category** selector (auto = all categories).
- **Catalogue:** bundled ready-made CSV (`deploy/catalog`): 93 products, services and bundles in 18 categories, importable with one tap.
- **Telegram:** direct test button with clear reasons. Auto-detect now replaces a wrong chat id.
- **n8n:** a wrong webhook path is flagged.

## 8.10.0 — 2026-11-11 (large catalogue: 500+ products and services)
- **Bulk import** from CSV (Excel «CSV UTF-8») or a shared Google Sheets link:
  - Only the **category + name** are required. Arabic and English headers are both accepted (الفئة/الاسم/الاسم بالإنجليزية…, or category/titleAr/titleEn…). Lists are separated with `|`.
  - Missing fields are filled automatically: audience, occasions, image description, messages.
  - **Preview first** (nothing is saved): new, updated, new categories, rejected rows with line numbers. Then «تأكيد الاستيراد» (confirm import).
  - Upsert by code (slug), so re-importing the same sheet updates and never duplicates. Arabic-only names get a stable code. Missing categories are created.
  - Rows with unverified claims or prices in their messages are rejected (same QC rules).
  - Up to 5,000 rows per file, written in batches of 100.
- **Export / template:** `/api/products/export` produces a CSV that the importer reads back unchanged.
- **Products page:**
  - server-side search, filter by category and status;
  - 50 per page;
  - bulk activate/deactivate.
- **Account form:**
  - allow whole **categories** (includes products added later);
  - a searchable product list instead of hundreds of checkboxes.
- **Smarter rotation:** an account never repeats any of its last 10 products (fewer for small catalogues).
- Index `products(categoryId, active)`. Migration `20261112090000_catalog_scale` (additive).
- Bug found by the new tests and fixed: Arabic headers containing «إ/أ» were not recognised.
- Tests (203 passing): CSV parsing (Arabic headers, defaults, stable codes, duplicates, claims, Sheets link), 600-row import (preview writes nothing, commit, re-import updates, export round-trip), category allowance, rotation over 600 products.

## 8.9.1 — 2026-11-11 (n8n one-command setup)
- **Dashboard Telegram section:**
  - bot token (encrypted), chat id and allowed user ids;
  - **«اكتشاف تلقائي»** (auto-detect) reads the bot's updates to find the chat id and the user's id;
  - the webhook URL is pre-filled with the internal address.
- **`bash scripts/n8n-setup.sh`:**
  - takes or creates the secrets from the encrypted settings, so nothing with `_` or `:` has to be typed in the console;
  - updates `.env` safely and generates `N8N_ENCRYPTION_KEY`;
  - starts n8n and reloads Caddy;
  - imports the templates and the Telegram credential (fixed id), publishes 05/01/03/02, and sends a test event.
- The templates are mounted in the n8n container at `/templates`. The archive branch runs only when `GDRIVE_FOLDER_ID` is set, so there are no error alerts before Google is connected.
- Verified against n8n 2.35.7: credential import, import of all 6 templates, publishing 4 of them, the helper output and the `.env` merge.

## 8.9.0 — 2026-11-11 (quality per format, interval and no-approval publishing in bulk)
- **Image quality per format** (`ai.qualityByFormat`):
  - Stories default to **low** (they live 24 h); every other format follows the global quality.
  - Budget checks and recorded costs use the effective quality.
  - The AI settings page shows a selector per format with the cost per design, plus «تطبيق الموصى به» (apply recommended).
- **Schedule page, bulk actions on the selected accounts:**
  - **publish every 5 / 7 / 9 hours** (or any value). The daily cap follows the cadence, and a shorter interval takes effect soon instead of after the old wait.
  - **«نشر بدون موافقة للمحدد»** (publish without approval): autonomous authorisation for linked accounts only, audited. It needs the `autonomy:authorize` permission and warns when the global mode is not «ذاتي». «إرجاع للموافقة اليدوية» returns accounts to manual approval.
- **Account form:** the interval is now chosen in hours.
- Tests: quality per format (low for a story, medium for a feed post) with recorded costs; HTTP smoke test of the bulk interval and autonomy. 190 tests passing.

## 8.8.2 — 2026-11-11 (enabling auto-publishing)
- The schedule page has a new section **«الحسابات المسموح لها بالنشر الآلي»** (accounts allowed to auto-publish): tick accounts, or use «تحديد كل المرتبطة» (select all linked), then «السماح بالنشر الآلي للمحدد» (allow selected) in one click. Previously each account had to be opened separately.
  - Accounts without a verified Metricool connection are never enabled. The reason is reported per account.
- The ambiguous label «غير مرتبط/غير مفعّل» is replaced by the exact reason for each account:
  - not linked to Metricool;
  - connection broken (status);
  - emergency-paused;
  - «مرتبط ✓ — النشر الآلي غير مسموح بعد» (linked, auto-publishing not allowed yet).
- The scheduler text now says 7 hours.
- HTTP smoke test: start → NO_ACCOUNTS; bulk enable → 2 changed, 1 unlinked skipped with reason; start → on.

## 8.8.1 — 2026-11-11 (fix: «الموجز لا يطابق المخطط: String must contain at most 30 character(s)»)
- **Root cause:** the text model sometimes writes a CTA longer than 30 characters, or other over-long fields. Strict schema validation then rejected the whole brief. Retries repeated the same mistake, so the design failed with no media.
- **Fix:** `normalizeBrief` fits fields to their limits before validation.
  - Text is cut at a word boundary.
  - Captions drop whole trailing lines, never half a sentence.
  - Hashtags and slides are capped.
  - An over-long or missing CTA is replaced by the official CTA, which is what the design uses anyway.
- The JSON schema descriptions now state the limits, so the model rarely exceeds them.
- A genuinely broken reply now gives an Arabic, field-specific message instead of English Zod text.
- New **«إعادة التوليد بنفس الإعدادات»** button on failed designs.
- Regression tests reproduce the exact error. 189 tests passing.

## 8.8.0 — 2026-11-11 (competitor analysis)
- **New تحليل المنافسين page:**
  - benchmark: followers, growth, posts per week, Reel share, average interactions, engagement rate, sample size, and our own row;
  - Reel vs feed interactions;
  - best hour and best day (each needs at least 3 posts);
  - top 10 posts;
  - themes from the top quarter, hashtags, and **content gaps**;
  - data-backed competitive recommendations;
  - original ideas inspired by the market (no copying), with one click to the create page.
- **Sources:**
  - Metricool Instagram competitors: a daily read-only pull, with tolerant parsing and endpoints that still need live verification;
  - **CSV export import**, with flexible English/Arabic headers, BOM and `;` support, and same-day merging.
  - Instagram is never scraped.
- **`CompetitorSnapshot` table** for growth trends.
- **Advisor rules:** no competitor data; stale data.
- **n8n:** `GET /competitors`.
- A test caught a design flaw: the day×hour grid was too sparse for local accounts, so a "best time" could never appear. Hour and day are now analysed separately.
- 184 tests passing.

## 8.7.0 — 2026-11-11 (Google services)
- **Google Business Profile** (channel `gmb` via Metricool):
  - an image design is sent as `publication` (text ≤ 1500 + cover image); a Reel is sent as `photo` (video to the gallery, no text).
  - A separate **satellite job**: Google rejects posts containing phone numbers and ignores hashtags, so the Google copy has neither and adds a local line naming both branches.
  - Satellite jobs never change the advertisement's state (`ad-state.ts`).
  - `PublicationJob.networks` and `PublicationJob.primary` were added.
- **YouTube Shorts:** title capped at 100 characters, tags taken from the hashtags, category, AI-content declaration.
- **Google Drive + Sheets archive** (n8n template 06, called by 01 for every verified publication): the exact published files plus a log row. The file download and naming were verified in a real n8n 2.35.7. Live test finding: n8n 2.x requires the sub-workflow to be published.
- Profile parsing detects a linked GBP. The posts log shows the networks per job and marks companion copies.
- Docs: `docs/GOOGLE_SERVICES.md`.
- 175 tests passing.

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
