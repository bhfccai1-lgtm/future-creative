# Security

## Reporting
Report security problems privately to the system owner — never in a public issue.

## Automated checks (GitHub)
- **CI** on every push: typecheck, unit + integration tests (PostgreSQL/Redis), production build, production Docker image.
- **CodeQL** (security-extended) on every push and weekly.
- **Dependabot**: weekly grouped minor/patch updates; risky majors (Next, Prisma, React, TypeScript, Zod, Node) are planned manually.
- Secrets are never committed: keys and tokens are entered in the dashboard and stored encrypted (AES-256-GCM) in the database. `.env` is git-ignored; `.env.example` holds no secrets.

## Known advisories and mitigations (2026-11)
| Package | Advisory | Exposure here | Status |
|---|---|---|---|
| zod < 4.6.6 | memory exhaustion validating oversized constrained collections | API input validation (almost all endpoints require login) | **Mitigated**: request size limits before parsing (JSON 1 MB, uploads 60 MB) in `src/middleware.ts`. Planned: Zod 4 migration |
| postcss ≤ 8.5.22 (via next) | XSS in CSS stringify output | build-time only, our own CSS — no user input | Low; resolved with the planned Next 16 upgrade |
| deepmerge-ts < 8 (via prisma) | stack exhaustion on recursive objects | CLI at build/migrate time only — no user input | Low; resolved with the planned Prisma 7 upgrade |
