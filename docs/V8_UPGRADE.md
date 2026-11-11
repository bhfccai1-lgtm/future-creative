# V8 Enterprise upgrade: audit, status, security review, deployment and rollback

## 0. Baseline: what the repository actually contained
The V8 brief assumed things that do not match this repository. The upgrade follows the repository.

| Assumption in the brief | Reality in this repository |
|---|---|
| "V7 with 21 Claude Code skills and agents" | The repository had **no** Claude Code skills or agents. V8 adds 8 skills and 1 agent, all backed by real code. |
| n8n and Google Drive are part of the stack | Neither is integrated. The owner earlier said the n8n server is not needed. Backups use `scripts/backup.sh`. Google Drive archiving is still not implemented. |
| Logo file "276426.png" | The system uses the logo the admin uploaded and approved, verified by SHA-256 on every render and before every submission. No file with that name is in the repository, and none was assumed to be. |

## 1. Audit findings

### Verified defects (reproduced in code or tests) → fixed
| # | Priority | Defect | Evidence | Fix |
|---|---|---|---|---|
| 1 | **P0** | An UNKNOWN submission was **automatically re-sent** once a time-plus-text search failed to find the post. A search miss (listing lag, edited text) could create a **duplicate post**. | `reconcile.ts` (old `REQUEUED` path); test `absent at provider … re-queues` | The job stops in `UNKNOWN` and notifies an operator. `resolveUnknownJob` re-checks the provider before any resend. The old behaviour is opt-in only. |
| 2 | **P1** | Approval was not bound to the media bytes. The publisher only checked that the file existed, so a replaced or tampered file would have been published. | `publisher.ts` pre-flight | The approval stores `mediaSha256`. The publisher re-hashes the file on disk and compares it with both the render hash and the approval hash. Test: *a file modified after approval is never sent*. |
| 3 | **P1** | No per-account emergency stop. Turning auto-publishing off did not stop jobs that were already queued. | `processPublishJob` had no account check | `SocialAccount.paused` holds and refuses submissions and skips generation. Tests cover the scheduler and the publisher. |
| 4 | **P1** | A stuck `PUBLISHING` lease was only detected when the worker restarted. | `recovery.ts` | `sweepStuckJobs` runs every 5 minutes and moves expired leases to UNKNOWN. Test included. |
| 5 | P2 | The default cadence was hourly (24 per day) instead of every 7 hours. | `schema.prisma` | Defaults changed to 420 minutes and 4 per day. The migration moves only untouched defaults. |
| 6 | P2 | No analytics import, reports or experiments. Metrics were manual only. | `FEATURES_STATUS.md` | `src/lib/analytics/*`, the reports page, the worker job and the CLI. |
| 7 | P2 | The top bar showed "OpenAI مباشر" (live) with no key configured, a misleading status. | Seen in a screenshot during the smoke test | The badge now depends on the key actually being configured. |
| 8 | P2 | API routes returned 500 for missing records. | HTTP smoke test | Prisma `P2025` is mapped to 404. |
| 9 | P3 | Plain-text worker logs with no correlation IDs and no redaction helper. | `worker/index.ts` | `src/lib/ops/log.ts`: JSON lines, redaction, correlation ID = idempotency key. |
| 10 | P3 | No system diagnostics and no worker liveness signal. | — | `/diagnostics`, `/api/diagnostics`, Redis heartbeat. |
| 11 | P3 | Filter dropdowns stretched to full width (Tailwind width overridden). | Screenshot | Explicit widths. |

Bugs found **by the new tests** during V8 and fixed before commit:
- The analytics query used `NOT metricsSource = 'manual'`, which also excluded rows where the field is NULL (SQL NULL semantics). Nothing was ever imported. Fixed with a NULL-safe filter.
- URL matching treated `www.instagram.com` and `instagram.com` as different posts. Fixed by normalising the URL.

### Suspected risks (not reproduced; still open)
- **Metricool analytics endpoint** (`/v2/analytics/{posts|reels|stories}/instagram`) and its field names have **not been called against a live account** in this session. The parser accepts several field-name variants, a failure is reported as an error, and nothing is invented. Press "استيراد مقاييس Metricool الآن" (import Metricool metrics now) once after deploying to confirm.
- Reconciliation of an UNKNOWN job (`findExisting`) searches by time window and text. That is why resending is now an operator decision.
- A post already scheduled in Metricool cannot be cancelled from this system: the provider delete endpoint is not implemented. Delete it in Metricool's planner.
- The Malayalam texts still need review by a native speaker.

## 2. Implementation status
| Area | Implemented | Automated tests | Deployed | Externally verified |
|---|---|---|---|---|
| Operator-controlled UNKNOWN resolution | ✅ | ✅ | ❌ (needs server update) | ❌ |
| SHA-256 approval binding and byte integrity | ✅ | ✅ | ❌ | n/a |
| Per-account pause | ✅ | ✅ | ❌ | n/a |
| Stuck-lease sweep and worker heartbeat | ✅ | ✅ (sweep) / smoke (heartbeat) | ❌ | n/a |
| 7-hour default cadence | ✅ | ✅ | ❌ | n/a |
| QC verdicts, request changes, revision history | ✅ | ✅ (verdicts) / build+HTTP (UI) | ❌ | n/a |
| Metricool analytics import | ✅ | ✅ (fake provider) | ❌ | ❌ **not called live** |
| Pattern engine, A/B suggestions, reports | ✅ | ✅ | ❌ | n/a |
| Diagnostics page/API | ✅ | HTTP smoke + screenshot | ❌ | n/a |
| Claude Code skills, agent and CLI | ✅ | CLI run against the test DB | ❌ | n/a |
| Carousels | ❌ | — | — | — |
| English dashboard UI | ❌ (Arabic only; English and Malayalam content generation exist) | — | — | — |
| Voiceover, licensed music library, generative AI video | ❌ (Reels are FFmpeg motion from AI stills; synthesized ambient/upbeat audio; optional Instagram licensed audio passed through Metricool) | — | — | — |
| n8n integration (events, inbound API, 4 templates) | ✅ | ✅ (incl. template signature compatibility) | ❌ | ❌ not run against a live n8n |
| Email/SMS notifications (Telegram is available through n8n), Google Drive archive | ❌ | — | — | — |

"Deployed ❌" means this session did not update the production server (it has no access to it). Follow §4.

## 3. Security and reliability review
- **Secrets:** stored AES-256-GCM-encrypted in the database or in env vars. Diagnostics, the CLI and the UI report only configured / not configured, with no value and no last 4 characters (`secretStatus().last4` is not displayed by the new code). The logger masks secret-looking keys and token-like values (`sk-…`, `Bearer …`, JWTs). Test: `log redaction`.
- **Publishing safety chain** (all enforced on the server and tested):
  - kill switch;
  - account pause;
  - dry-run refusal;
  - QC publishable;
  - logo fingerprint;
  - media byte hash against the render and the approval;
  - verified connection with publish permission;
  - channels linked;
  - atomic claim (exactly one submit with 5 concurrent workers);
  - idempotency key;
  - UNCERTAIN → UNKNOWN → operator decision;
  - PUBLISHED only after the provider confirms.
- **Authorisation:**
  - The pause route needs `killswitch:toggle` (ADMIN/EDITOR).
  - Resolving an UNKNOWN job needs `publish:now`.
  - Analytics import needs `settings:integrations` (ADMIN).
  - Reports and diagnostics are view-only (`dashboard:view`).
  - All mutating routes keep the CSRF and same-origin checks.
- **Claude Code:**
  - Skills list only `bash scripts/ig/run.sh …` in `allowed-tools`.
  - The agent has Bash and Read only.
  - State-changing CLI commands require `--confirm`.
  - The CLI never calls the provider's submit. Resubmission only re-queues for the guarded worker, after a fresh lookup.
  - The kill switch, autonomous authorisation and API keys stay dashboard-only.
- **Data integrity:** the migration only adds columns; one data UPDATE changes defaults. Analytics never overwrites manual entries and never stores invented zeros (absent metrics are omitted).

## 4. Deployment on the existing Hetzner server (Ubuntu 24.04, Docker Compose)
No new services or purchases are needed.
```bash
cd /opt/future-creative
./scripts/backup.sh                       # 1. database + media backup (keeps 14)
git rev-parse HEAD > /root/pre-v8-commit  # 2. remember the current version for rollback
git pull                                  # 3. (repo temporarily Public, or a deploy key)
docker compose up -d --build              # 4. the `migrate` service applies the V8 migration automatically
docker compose ps                         # 5. web, worker, postgres, redis healthy
docker compose exec -T worker npx tsx scripts/ig/cli.ts health   # 6. diagnostics from the CLI
```
After deploying:
1. Open **تشخيص النظام** (system diagnostics). The worker must be "سليم" (healthy).
2. Open **التقارير والتجارب** (reports and experiments) and press **استيراد مقاييس Metricool الآن** (import Metricool metrics now). If the result contains errors, the analytics endpoint needs adjusting (see §1). Publishing is not affected.
3. Review each account's interval. Accounts on the old untouched default are now every 7 hours.

## 5. Rollback
The V8 migration only adds things, so the previous code runs on the new schema.
```bash
cd /opt/future-creative
git checkout "$(cat /root/pre-v8-commit)"
docker compose up -d --build
# optional: restore the previous cadence for accounts that were on the old default
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE social_accounts SET \"publishIntervalMinutes\"=60, \"maxDailyAds\"=24 WHERE \"publishIntervalMinutes\"=420 AND \"maxDailyAds\"=4;"'
```
Full restore of data (only if needed): `./scripts/restore.sh backups/<timestamp>`.
