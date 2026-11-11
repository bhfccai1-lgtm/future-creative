# n8n with Future Creative (on the same server, no extra cost)

```
Future Creative ──(signed events: HMAC-SHA256 + delivery id)──▶ n8n ──▶ Telegram / Sheets / …
Future Creative ◀──(API: Bearer token + Idempotency-Key)───────  n8n   (designs · approve/reject · pause · reports · diagnostics)
```
- **Publishing always goes through the system's protected pipeline:**
  - quality checks;
  - SHA-256 approval binding;
  - the kill switch and account pause;
  - Metricool verification.

  n8n cannot publish directly.
- **Events are never lost:**
  - They are stored in a durable outbox and retried after 1/5/15/60/360 minutes.
  - **404 is treated as temporary**, because n8n answers 404 while a workflow is inactive or still starting.
  - Failed events can be resent from the dashboard, or pulled with `GET /deliveries?since=`.
- **No duplicates:**
  - Every event carries an `X-FC-Delivery` id, and the template ignores an event it has already handled.
  - Every request from n8n carries an `Idempotency-Key`, so a retry never creates a second design or decision.
- Traffic between the two services is internal (`http://web:3000` and `http://n8n:5678`).

## Setup (once)
1. In the dashboard ← **إعدادات الربط** (Integrations) ← **n8n**:
   - Webhook URL: `http://n8n:5678/webhook/future-creative`.
   - **إنشاء سر توقيع الأحداث** (create event signing secret) → copy it.
   - **إنشاء رمز API لـ n8n** (create n8n API token) → copy it.
   - Tick **تفعيل** (enable) and the events you want, plus what you allow from n8n:
     - designs (on by default);
     - approval (off);
     - pausing accounts (off).
2. In `.env` on the server:
   ```
   N8N_ENCRYPTION_KEY=<openssl rand -hex 32>   # keep it: n8n credentials depend on it
   FC_WEBHOOK_SECRET=<signing secret>
   FC_API_TOKEN=<API token>
   TELEGRAM_BOT_TOKEN=<from @BotFather>
   TELEGRAM_CHAT_ID=<group or chat id>
   TELEGRAM_ALLOWED_USER_IDS=<your id>,<a colleague's id>
   ```
3. `docker compose --profile n8n up -d`, then open `https://n8n.<DOMAIN>` and create the owner account.
4. **Workflows ← Import from File**. Import **05 first**: the others point to it as their error workflow.

   | File | Purpose |
   |---|---|
   | `05-error-alerts.json` | Any workflow failure → a Telegram message with the workflow name, node and error |
   | `01-events-to-telegram.json` | All events → Arabic messages. A new design arrives with its image and ✅/❌ buttons. Daily digest at 21:05, pending-approval reminders, budget/video/quality alerts, weekly report |
   | `02-telegram-bot.json` | The approve/reject buttons plus commands: `/pending`, `/status`, `/report [week\|month]`, `/pause <account> [reason]`, `/resume <account>`. Only `TELEGRAM_ALLOWED_USER_IDS` can act |
   | `03-morning-health-check.json` | Diagnostics at 8:15, only when there is a problem |
   | `04-ideas-sheet-to-designs.json` | Google Sheets ideas (tab `ideas`) → designs in the approval queue |
5. Credentials inside n8n (everything else is read from `.env`):
   - **Telegram FC bot** (Telegram API) for template 02.
   - **Google Sheets** for template 04. After importing, choose your sheet in both Sheets nodes.
6. Activate the workflows (Publish/Activate), then press **إرسال حدث اختبار** (send test event) in the dashboard.

> Telegram allows only one receiver per bot, so the buttons and the commands are in a single workflow (02). Don't add another Telegram Trigger on the same bot.

## The inbound API
Base: `http://web:3000/api/integrations/n8n`, header `Authorization: Bearer <FC_API_TOKEN>`. For POST requests, add `Idempotency-Key`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/accounts` | Accounts and their status |
| GET | `/ads?state=QUALITY_REVIEW&account=&since=&limit=` | Designs with signed preview links |
| GET | `/ads/{id}` | One design: caption, failed QC checks, publishable media, publication status |
| POST | `/generate` | New design in the approval queue |
| POST | `/ads/{id}/decision` | `approve` or `reject`. Requires the setting to be enabled |
| POST | `/accounts/{id}/pause` | `{ paused, by, reason }`. Requires the setting to be enabled |
| GET | `/reports?period=week\|month` | Verified-only report |
| GET | `/diagnostics` | System diagnostics |
| GET | `/deliveries?since=&event=` | The sent-event log, for catching up |
| GET | `/events` | Available and subscribed events |

## Events
- `ad.ready_for_review`
- `ad.approved`
- `ad.rejected`
- `publication.scheduled`
- `publication.published`
- `publication.failed`
- `publication.unknown`
- `connection.lost`
- `approvals.reminder`
- `daily.digest`
- `report.weekly`
- `system.alert`: budget, Veo fallback, invalid video, quality, recovery, generation failure, campaign done, connection restored
- `test.ping`

## Operations
- **Execution history:** n8n keeps failed executions and deletes the rest after 14 days (`EXECUTIONS_DATA_*`), so its database doesn't bloat.
- **Backup:** `scripts/backup.sh` also backs up the `n8n_data` volume (workflows and credentials). Keep `N8N_ENCRYPTION_KEY`, or the credentials can't be decrypted.
- **Monitoring:** the system's **تشخيص النظام** (diagnostics) page shows n8n health: failed events, delayed events, last successful delivery.
- **Editing the templates:** edit `generate_templates.py`, then run `python3 deploy/n8n/generate_templates.py`.

## What was verified (11 November 2026) on n8n 2.35.7
- All templates imported successfully.
- **The bot** ran against the real system:
  - `/status`, `/pending`, `/pause`, `/resume` worked;
  - an unauthorised user was ignored;
  - a button on a missing design returned a clear message.
- **Events:** a budget alert and the daily digest arrived as formatted messages. A resent event was **ignored** (no duplication).
- **A real flaw found and fixed:** 404 during n8n startup was treated as a permanent failure. It is now retried.
- **Not tested:** the real Telegram servers (blocked in the test environment; a local server stood in for them) and Google Sheets (needs your account).
