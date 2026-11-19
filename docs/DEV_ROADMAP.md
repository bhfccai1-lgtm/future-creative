# System development study — November 2026

A professional review of FUTURE CREATIVE: what was found, what was done in this round, and the next steps in order of value.
It is updated with every round; the newest decisions are at the top.

## 1. Findings

| # | Finding | Risk | Status |
|---|---|---|---|
| 1 | `main` turned red: Dependabot security PRs (#14 vitest 4, #15 zod 4) were merged while their CI was failing. zod 4 changes runtime behaviour that the compiler does not catch: `.default({})` no longer fills inner defaults, `.partial()` fills defaults (a PATCH would reset fields), and records over enums require every key | **High** — settings would read back empty; editing an account would reset its products/channels | ✅ fixed (PR #16 merged into the fix) |
| 2 | `main` has no branch protection, so a PR with a red CI can be merged | High (it caused #1) | ⏳ needs the owner — see §3 |
| 3 | No user-management screen: staff accounts could only be created on the server's command line; no way to disable an account, unlock it, reset a forgotten password, or change your own password | Medium (security + daily operation) | ✅ done |
| 4 | The AI-proofreading setting (`useAiReview`) existed but did nothing | Medium (quality) | ✅ wired |
| 5 | Designs were scored against the algorithm index only after the fact | Medium (reach) | ✅ algorithm gate (9c5aaaa) |
| 6 | An advisor test depended on the free disk space of the machine running it, so local runs were never fully green | Low | ✅ the test no longer reads the real disk |
| 7 | Remaining dependency advisories: `next` (needs v16), `prisma` CLI (needs v7), `postcss` at build time, `typescript-eslint`/`minimatch` in dev tools | Low–medium: none is reachable from a client request | 📋 planned (§2) |
| 8 | Alerts appear only in the dashboard: there is no e-mail, WhatsApp or push delivery | Medium (a failure at night goes unnoticed) | 📋 planned |
| 9 | Direct platform adapters (Meta Graph and others) are not implemented; everything goes through Metricool | Medium (single provider) | 📋 later |

## 2. Next steps (in order)

1. **Branch protection on `main`** (owner, 1 minute — §3). It stops a repeat of finding #1.
2. **Alert delivery to the owner's phone** (WhatsApp Cloud API is already connected for catalogue/leads): critical alerts only (publishing stopped, worker down, budget reached), with a quiet-hours window and a daily limit.
3. **Framework upgrades as planned PRs, one at a time:** Next 15 → 16 (clears the `next`/`postcss` advisories), then Prisma 6 → 7. Each gets its own branch, the full test suite, and a visual check of the main pages on a phone.
4. **«Must change password at first login»** for accounts created by an administrator (needs a small migration).
5. **Direct Instagram Graph adapter** as a second publishing path when Metricool is unavailable.

## 3. For the owner — require green CI before merging (GitHub website)

Settings → Branches → **Add branch ruleset** (or *Add classic branch protection rule*):
- Branch name pattern: `main`
- ✅ Require status checks to pass → add **`ci-ok`**
- Leave «Require a pull request» off if direct commits from the assistant should keep working.

After that, GitHub disables the merge button while CI is red. This applies to Dependabot PRs too.

## 4. How this round was verified
- `tsc` and `eslint` are clean; the full unit and integration suites run locally against PostgreSQL and Redis.
- New tests: `tests/unit/zod-v4.test.ts`, `tests/integration/team-users.test.ts`, `tests/unit/ai-proofread.test.ts`, `tests/integration/ai-proofread.test.ts`.
- CI on GitHub: build, three integration shards, docker, CodeQL, dependency review.
