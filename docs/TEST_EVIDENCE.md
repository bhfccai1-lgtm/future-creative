# Test evidence (actually executed)

**Environment:** Linux container, Node 22.23, PostgreSQL 16, Redis 7.0, FFmpeg 6.1.1, executed on 2026-11-08.
**Important:** all provider interactions were **mocked** (`FakeAdapter`, `FakeAiProvider`, and mocked `fetch` for the Metricool adapter). A passing test is evidence of the system's own logic, **not** proof that a real social-media post was published or that the OpenAI API was called. No real OpenAI key or Metricool account was available.

## 1. Typecheck, lint and automated tests (verbatim output)
```
$ npx tsc --noEmit
OK (0 errors)

$ npx next lint
✔ No ESLint warnings or errors

$ npx vitest run --reporter=verbose
 ✓ |integration| tests/integration/publishing.test.ts > manual approval workflow > MANUAL mode: nothing is queued until a human approves; approval is audited 2380ms
 ✓ |integration| tests/integration/publishing.test.ts > manual approval workflow > cannot approve a design that failed QC; rejected ads can never be queued 2202ms
 ✓ |integration| tests/integration/publishing.test.ts > manual approval workflow > dry-run ads are refused at publication time 2162ms
 ✓ |integration| tests/integration/publishing.test.ts > autonomous authorisation > AUTONOMOUS mode without per-account authorisation still requires approval 2191ms
 ✓ |integration| tests/integration/publishing.test.ts > autonomous authorisation > AUTONOMOUS mode requires the global authorisation record too 2219ms
 ✓ |integration| tests/integration/publishing.test.ts > autonomous authorisation > fully authorised account: QC-passed scheduler content is auto-approved and queued (audited) 4134ms
 ✓ |integration| tests/integration/publishing.test.ts > job idempotency and locking > creating the publication job twice returns the same job (unique idempotency key) 2088ms
 ✓ |integration| tests/integration/publishing.test.ts > job idempotency and locking > five concurrent workers submit the job exactly once 2303ms
 ✓ |integration| tests/integration/publishing.test.ts > verification: SCHEDULED is not PUBLISHED > only provider-confirmed status marks a post PUBLISHED 2436ms
 ✓ |integration| tests/integration/publishing.test.ts > verification: SCHEDULED is not PUBLISHED > provider-reported error after scheduling marks FAILED 2206ms
 ✓ |integration| tests/integration/publishing.test.ts > failed publishing requests > definitive rejection → FAILED; 401 also revokes the connection publish permission 2246ms
 ✓ |integration| tests/integration/publishing.test.ts > failed publishing requests > expired authorisation is detected before submitting 2221ms
 ✓ |integration| tests/integration/publishing.test.ts > failed publishing requests > logo replaced after design was made → publication blocked 2157ms
 ✓ |integration| tests/integration/publishing.test.ts > unknown publication states and reconciliation > uncertain submit → UNKNOWN; no blind retry; reconcile finds the post → SCHEDULED 2254ms
 ✓ |integration| tests/integration/publishing.test.ts > unknown publication states and reconciliation > absent at provider: waits for the grace period, then re-queues (bounded) 2565ms
 ✓ |integration| tests/integration/publishing.test.ts > provider rate limits > 429 from provider puts the job back in the queue with a delay (it was not accepted) 2404ms
 ✓ |integration| tests/integration/publishing.test.ts > provider rate limits > local shared limiter throttles before calling the provider 6478ms
 ✓ |integration| tests/integration/publishing.test.ts > kill switch > halts publishing immediately and blocks new publication jobs 4098ms
 ✓ |integration| tests/integration/publishing.test.ts > restart recovery > jobs interrupted mid-submission become UNKNOWN (reconciled, never resubmitted blindly) 2138ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > dry-run: generates a complete layered design, passes design QC, but is never publishable 2342ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > real-AI path (mocked provider): records token/image usage and costs; ad is publishable 2277ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > blocks generation when no approved logo exists 161ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > blocks generation when the stored logo no longer matches its SHA-256 fingerprint 143ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > failed AI requests: non-retryable auth error fails the ad and raises a critical alert 168ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > failed AI requests: retryable errors are retried within the configured limit 3713ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > monthly spending limit blocks AI generation before any call is made 144ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > enforces the per-account daily limit 2153ms
 ✓ |integration| tests/integration/pipeline.test.ts > content generation pipeline > respects the account product allow-list 6322ms
 ✓ |integration| tests/integration/pipeline.test.ts > duplicate prevention > never repeats an idea or headline on the same account within the window 8406ms
 ✓ |integration| tests/integration/pipeline.test.ts > duplicate prevention > detects exact-file and perceptual duplicates; history is per account 2192ms
 ✓ |integration| tests/integration/pipeline.test.ts > reel pipeline > produces and stores a validated MP4 (not a still image) for REEL_VIDEO accounts 17101ms
 ✓ |unit| tests/unit/video.test.ts > real video reel pipeline > renders an animated 1080x1920 H.264 MP4 of the requested duration that passes validation 20446ms
 ✓ |unit| tests/unit/video.test.ts > real video reel pipeline > rejects videos that do not meet Reels requirements 268ms
 ✓ |unit| tests/unit/render.test.ts > Arabic text rendering > shapes Arabic text with the embedded font and fits the box 125ms
 ✓ |unit| tests/unit/render.test.ts > Arabic text rendering > shrinks long headlines and reports overflow honestly when impossible 3167ms
 ✓ |unit| tests/unit/render.test.ts > Arabic text rendering > detects characters missing from the font 5ms
 ✓ |unit| tests/unit/render.test.ts > layered advertisement composition > produces a 1080x1920 design with logo, headline, CTA and both phone numbers as separate layers 2119ms
 ✓ |unit| tests/unit/render.test.ts > layered advertisement composition > renders English and Malayalam variants with correct glyph coverage 1444ms
 ✓ |integration| tests/integration/scheduler.test.ts > hourly scheduler > does nothing until auto-publishing is explicitly started 244ms
 ✓ |integration| tests/integration/scheduler.test.ts > hourly scheduler > Mode A: plans one slot per eligible account for the next hour, idempotently 144ms
 ✓ |integration| tests/integration/scheduler.test.ts > hourly scheduler > respects each account's own interval and publishing window 154ms
 ✓ |integration| tests/integration/scheduler.test.ts > hourly scheduler > Mode B: caps the number of posts per hour across selected accounts 163ms
 ✓ |integration| tests/integration/scheduler.test.ts > hourly scheduler > skips disconnected accounts, accounts with pending scheduled posts, and everything under the kill switch 156ms
 ✓ |integration| tests/integration/scheduler.test.ts > multi-account isolation > disconnecting one account cancels only its queued jobs and leaves others untouched 145ms
 ✓ |integration| tests/integration/scheduler.test.ts > multi-account isolation > per-account settings (language, format) are independent 4145ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > unverifiable claims detection > flags prices, discounts, delivery times and superlatives 5ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > unverifiable claims detection > accepts clean brand copy 0ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > phone number validation > allows only the approved business numbers 1ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > language / script checks > detects wrong-language copy 2ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > language / script checks > lints typographic errors 3ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > layout geometry checks > passes a clean layout 0ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > layout geometry checks > detects overlap, overflow, missing glyphs and unsafe placement 0ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > layout geometry checks > computes WCAG contrast 0ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > duplicate detection primitives > normalises Arabic variants 2ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > duplicate detection primitives > scores paraphrases high and different concepts low 1ms
 ✓ |unit| tests/unit/qc-and-dedup.test.ts > duplicate detection primitives > perceptual hash: re-encoded / resized copies are close, different scenes far 206ms
 ✓ |unit| tests/unit/security.test.ts > encrypted secrets (AES-256-GCM) > round-trips and never stores plaintext 33ms
 ✓ |unit| tests/unit/security.test.ts > encrypted secrets (AES-256-GCM) > detects tampering and wrong keys 1ms
 ✓ |unit| tests/unit/security.test.ts > session tokens > signs and verifies, rejects tampered tokens 36ms
 ✓ |unit| tests/unit/security.test.ts > RBAC > viewer cannot publish or authorise autonomy; admin can 5ms
 ✓ |unit| tests/unit/security.test.ts > signed public media URLs > verifies valid signatures and rejects expired / altered ones 96ms
 ✓ |unit| tests/unit/security.test.ts > password policy > requires length and mixed characters 10ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > Metricool adapter (mocked HTTP — not proof of real publication) > builds a scheduler body in local Bahrain time with REEL type and AI disclosure 5ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > Metricool adapter (mocked HTTP — not proof of real publication) > sends auth header + userId/blogId 5ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > Metricool adapter (mocked HTTP — not proof of real publication) > maps outcomes: 2xx+id=ACCEPTED, 4xx=REJECTED, 429=RATE_LIMITED, 5xx/network/no-id=UNCERTAIN 4ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > Metricool adapter (mocked HTTP — not proof of real publication) > reports PUBLISHED only when every provider confirms it 1ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > Metricool adapter (mocked HTTP — not proof of real publication) > parses provider brands and only lists networks the provider reports 1ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > publication state machine > only allows legal transitions 1ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > product selection > rotates away from recently used products 0ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > product selection > favours better-performing products but still explores 3ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > product selection > returns null when nothing is allowed 0ms
 ✓ |unit| tests/unit/publishing-unit.test.ts > Bahrain time helpers > handles windows, month start and hour floors 2ms
 Test Files  8 passed (8)
      Tests  72 passed (72)
   Start at  17:16:18
   Duration  138.02s (transform 750ms, setup 19ms, collect 5.83s, tests 129.18s, environment 2ms, prepare 449ms)

```

## 2. Production build
`npx next build` completed successfully. It produced 15 dashboard pages, the login page, the ad-detail page and 30 API routes, plus middleware. The only warnings come from `jose`'s unused JWE compression module on the Edge runtime; they are harmless.

## 3. End-to-end browser run (Playwright + Chromium against `next start` and a running worker)
```
17:11:03 redirected to http://localhost:3000/login          # unauthenticated → login
17:11:04 logged in
17:11:06 start-automation message: لا توجد حسابات مرتبطة ومفعّل لها النشر الآلي. اختر الحسابات المسموح لها أولًا.   # backend refused, UI shows it
17:11:09 logo approved: 1                                     # upload → validate → SHA-256 → approve
17:11:15 ad page http://localhost:3000/ads/cmw839si900037dpc48rzrrh7          # "إنشاء إعلان الآن" → worker → QC → ad page
17:11:49 reel ad page http://localhost:3000/ads/cmw839wmd000o7dpcwda0ptfc video tags: 1   # real MP4 reel through the UI
17:11:54 POST without CSRF token -> 403
```
Screenshots: `docs/evidence/01-dashboard.jpg` … `06-library.jpg`. Design previews (AR/EN/ML × 2 templates): `docs/evidence/design-previews.jpg`. Reel frames at 0.5 s, 1.2 s, 4 s and 10.5 s: `docs/evidence/reel-frames.png`.

## 4. Required test areas → tests
| # | Area | Test(s) |
|---|---|---|
| 1 | Account configuration | scheduler.test › per-account settings are independent; accounts API validation schema |
| 2 | Product selection | publishing-unit › rotates / favours performance / null; pipeline › respects allow-list |
| 3 | Content generation | pipeline › dry-run layered design; real-AI path records usage |
| 4 | Arabic text rendering | render › shapes Arabic (joined width < isolated letters), shrink/overflow, glyph coverage |
| 5 | Logo fingerprint verification | pipeline › no logo / tampered logo; publishing › logo replaced after render; render › pixel-level logo tamper detection |
| 6 | Phone number insertion | render › both phone layers with exact numbers, RTL order; qc › wrong numbers rejected |
| 7 | Duplicate prevention | pipeline › never repeats idea/headline; SHA-256 + pHash + cross-account + window; qc › pHash robustness |
| 8 | Hourly scheduler | scheduler › Mode A, idempotent slot, intervals/windows, Mode B cap, off by default |
| 9 | Job idempotency | publishing › same idempotency key; five concurrent workers → exactly one submit |
| 10 | Manual approval | publishing › MANUAL mode; cannot approve QC-failed; dry-run refused |
| 11 | Autonomous authorization | publishing › three autonomous-authorisation tests |
| 12 | Failed AI requests | pipeline › non-retryable auth; retryable retried |
| 13 | Failed publishing | publishing › 401 rejection, expired token, logo changed |
| 14 | Unknown states | publishing › UNKNOWN → reconcile found; absent → grace → bounded requeue |
| 15 | Restart recovery | publishing › interrupted PUBLISHING → UNKNOWN; stale GENERATING → FAILED |
| 16 | Video validation | video › real animated MP4 passes; bad video rejected; pipeline › reel stored |
| 17 | Monthly spending limit | pipeline › budget blocks before any AI call |
| 18 | Kill switch | publishing › kill switch; scheduler › kill switch |
| 19 | Provider rate limits | publishing › 429 requeue with Retry-After; shared limiter |
| 20 | Multi-account isolation | scheduler › disconnect isolation; per-account dedup history |

## 5. Bugs found by these tests and fixed
* Arabic repeated-word lint used `\b`, which is ASCII-only in JavaScript, so Arabic repeats were missed. Fixed with Unicode-aware lookarounds.
* The budget was checked only per call, so a text call could spend near the cap before the image call was blocked. An up-front check for the whole ad was added.
* Text line counting gave wrong results because libvips crops text to ink bounds. It now uses a measured line advance.

## 6. Not verified here
* Live OpenAI and Metricool calls (no credentials).
* **Docker image build:** `docker compose config` validated. `docker build` reached `npm ci`, which failed inside the build container because this sandbox's egress proxy isn't available to Docker builds. This is an environment limitation, not a Dockerfile error, but the image has therefore **not** been built and run here. Build it on the target server (`docker compose up -d --build`).
* HTTPS through Caddy with a real domain, and the backup/restore scripts.
