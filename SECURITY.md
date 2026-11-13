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

## Security audit — 2026-11-13 (threat model + OWASP review)
Trust boundaries reviewed: dashboard API, public routes (`/p/`, `/api/m/`, `/api/public-media`, `/api/health`, `/manifest.webmanifest`, `/icons/`), n8n integration API, signed provider webhook, outbound calls (Metricool, OpenAI, Meta Graph, Telegram, Google Apps Script, Google Sheets), file uploads, AI output.

| Area | Finding | Result |
|---|---|---|
| Authorization | every dashboard API route goes through `api(permission)`; every n8n route through `integrationApi` (constant-time 256-bit bearer, 120/min) | ✓ |
| Sessions / CSRF | `httpOnly` + `secure` + `sameSite=strict` cookie, session version, double-submit CSRF token + same-origin check | ✓ |
| Login | 10 attempts / 5 min per IP (Redis), lock after 5 failures, constant-time path for unknown users, generic errors | ✓ (relies on Caddy setting `X-Forwarded-For`; the app port is not published) |
| Webhook | HMAC-SHA256 over timestamp+body, 5-minute window, payload never trusted as proof | ✓ |
| Media links | HMAC-signed, expiring, `ads/` prefix only, `..` rejected | ✓ |
| SQL injection | Prisma only; no raw SQL | ✓ |
| XSS | React escaping; no `dangerouslySetInnerHTML`; AI text escaped before SVG/Pango markup | ✓ |
| Uploads | size caps; audio verified with ffprobe; logo re-encoded to PNG (no SVG passthrough) | ✓ |
| SSRF | Sheets URL rebuilt on docs.google.com; archive URL limited to script.google.com; Meta/Telegram fixed hosts | ✓ |
| **Metricool base URL** | was any URL → a changed setting could send the publishing token to another server | **Fixed**: only `https://*.metricool.com`, enforced at save and at use |
| **Security headers** | no CSP / app-level HSTS | **Fixed**: `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`, HSTS, COOP (verified: 0 CSP violations) |
| DoS | request size limits before parsing (JSON 1 MB, uploads 60 MB) | ✓ |
| Secrets | encrypted at rest (AES-256-GCM), never returned to the browser; repository + full history scanned clean | ✓ |
