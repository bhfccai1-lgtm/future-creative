---
name: fc-dev
description: Development workflow for the FUTURE CREATIVE codebase. It covers the local Postgres/Redis setup, test databases, typecheck/lint/unit/integration runs, a phone-sized UI check of a page, migration drift, the zod-v4 pitfalls, and the branch → PR → green CI → merge → release flow. Use it before changing code in this repository: "طوّر", "أضف ميزة", "أصلح", "اختبر", "جهّز إصدار", "افتح PR".
---

# FUTURE CREATIVE — development workflow

Next.js 15 (App Router) · React 19 · Prisma 6 / PostgreSQL 16 · BullMQ / Redis 7 · sharp · vitest 4 · zod 4.
The owner reads Arabic: reply in Arabic, and keep code, commits and PR text in English.

## 0. Ground rules (the owner's standing instructions)
- Work on a **branch**, open a **PR**, and wait for **green CI** before asking to merge. Never push to `main` directly, and never merge without the owner's OK.
- **No stacked PRs.** Every PR is based on `main` and targets `main`, one feature at a time. A stack (#24 → #25 → … → #29) once merged into the intermediate branches, so four features never reached `main` and a release PR had to bring them in. If a feature needs an unmerged one, wait for the merge, or ship both in one PR.
- Never ask for passwords or API keys in chat; keys go only into the app's settings forms. Never change deploy settings or server keys unasked.
- No new npm packages, GitHub Apps or third-party installs without an explicit request. Major upgrades of next / prisma / react / typescript / zod are planned PRs.
- Ask before anything that spends money (paid AI calls outside tests, paid GitHub features). New AI features ship **off by default**, or with a small and stated cost.
- Never auto-publish, and never fake engagement.
- No model identifiers in commits or PRs.

## 1. Local services (the container)
```bash
pg_ctlcluster 16 main start 2>/dev/null; redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes
export DATABASE_URL=postgresql://fc:fc@localhost:5432/fcap_test   # integration tests (truncated per test)
```
UI checks use a separate database, `fcap_ui`, with the admin `ui@test.bh`. Its password is the local test value from the session notes, never a real one.

## 2. The checks (run all of them before a PR)
```bash
npx tsc --noEmit -p .
npx eslint src tests --quiet
npx vitest run tests/unit                 # ~3 min
npx vitest run tests/integration          # ~15 min; run it in the background
npx prisma migrate deploy && npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code   # same as CI: a schema change ⇒ a migration
```
- Every new behaviour gets a test: unit for pure logic, integration (`tests/integration/*.test.ts` with `seedBase()`) for anything that touches the database or the pipeline.
- `seedBase()` runs with `autoRenderMode: 'layered'` and `imageQualityGate: false`. Tests that need the production defaults opt in (`seedBase({ autoRenderMode, imageGate: true })`).
- `FakeAiProvider` is the paid-AI stand-in. Subclass it to script vision or JSON answers; never call real providers in tests.

## 3. A phone-sized UI check (after any UI change)
1. Start the dev server against `fcap_ui`:
   `DATABASE_URL=…/fcap_ui APP_ENCRYPTION_KEY=$(printf 'a%.0s' {1..64}) SESSION_SECRET=$(printf 's%.0s' {1..40}) LOCAL_STORAGE_DIR=<scratch>/uimedia COOKIE_SECURE=false FONT_DIR=./assets/fonts npx next dev -p 3100`
2. Run a Playwright script with `devices['iPhone 13']` and `locale: 'ar'`. It should:
   - log in, open the page and use the real form;
   - assert `document.documentElement.scrollWidth === 390` (no sideways scroll);
   - collect console errors;
   - take a screenshot and look at it.
3. Stop the server afterwards (`pkill -f "next dev -p 3100"`).

Known noise: hydration warnings from collapsible `<Card>` (`open={true}` vs `null`) already exist and are not caused by your change.

## 4. Pitfalls that already bit this codebase
| Pitfall | Do this |
|---|---|
| zod 4 `.default({})` on an object does **not** fill inner defaults | `.prefault({})` |
| zod 4 `.partial()` **fills defaults** → a PATCH resets unsent fields | `patchSchema(Schema)` from `src/lib/validation.ts` |
| zod 4 `z.record(z.enum([...]), …)` requires **every** key | `z.partialRecord(...)` |
| Client `fetch` to `/api/*` gets a 403 | use `apiCall()` from `@/lib/client/api` (it sends `x-csrf-token`) |
| Arabic paragraph lines end on the wrong side in Pango | swap left/right for RTL paragraphs (see `print/text.ts`) |
| Dates differ between server and client (hydration) | `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain' })` |
| A `<fieldset>` overflows on a phone | add `min-w-0` |
| `Math.random()` or `x % n` on crypto bytes (CodeQL: biased) | rejection sampling (see `team-users.tsx`) |
| A Dependabot PR merged while red turned `main` red | the PR's «هل أدمج؟» comment must say ✅ before merging |
| A push to a PR branch rejected (the owner pressed «Update branch») | `git fetch origin +refs/heads/<b>:refs/remotes/origin/<b>`, merge it, then push. Never force over the owner's commits |

## 5. Commit → PR → merge → release
1. `git checkout -b feat/<topic>` from `main`, or from the PR branch it stacks on.
2. Commit messages are English and imperative, and end with the attribution lines the session gives you.
3. Add one entry per change to `## Unreleased` in `CHANGELOG.md`, written for the owner: what it does and how to switch it.
4. Open the PR through the REST API (GraphQL is blocked here), filling in `.github/pull_request_template.md`:
   `gh api repos/bhfccai1-lgtm/future-creative/pulls -f title=… -f head=<branch> -f base=<main|stacked branch> -F body=@pr.md`
5. Watch CI. Look at `ci-ok` on the head SHA, not just the build job:
   `gh api repos/bhfccai1-lgtm/future-creative/commits/<sha>/check-runs --jq '.check_runs[]|"\(.name): \(.conclusion)"'`
   If it fails, read the annotations of the failing run (`.../check-runs/<id>/annotations`), fix, push, and watch again.
6. When it is green, tell the owner in Arabic what changed, the merge order, and the server update command:
   `cd /opt/future-creative && git pull && bash scripts/update.sh`
7. **Release** (after merges): Actions → «Publish release» → minor/patch. It publishes only when green, and the server's `autoupdate.sh on` installs it within 10 minutes.

## 6. Where things live
- `src/lib/pipeline/generate.ts`: the ad pipeline. Gates in order: brief → AI proofreading (`useAiReview`) → algorithm gate (`fitToAlgorithm`) → scene + image quality gate (`imageQualityGate`) → compose → QC (`src/lib/qc/index.ts`).
- `src/lib/print/*`: the print studio (catalog, render, PDF/CMYK, dieline, QA, proof, quote, production).
- `src/lib/edu/*`: EDUCATION MASTER.
- `src/lib/creative/image-quality.ts` and `checked-image.ts`: the picture gate.
- `src/lib/auth/users.ts`: team members. `src/lib/settings.ts`: every setting (zod) — new fields need a default.
- `.github/workflows/`: `ci.yml` (build, 3 integration shards, docker, `ci-ok`), `merge-readiness.yml`, `publish-release.yml`, `codeql.yml`, `dependency-review.yml`, `release.yml`.
- `docs/DEV_ROADMAP.md`: findings and next steps. Update it when a round of work finishes.

For React / Next.js performance work, also load the `react-best-practices` skill in this folder.
