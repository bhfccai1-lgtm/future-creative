# n8n with Future Creative (on the same server, no extra cost)

## How it works
```
Future Creative ──(signed events: HMAC-SHA256)──▶ n8n ──▶ Telegram / Google Sheets / email…
Future Creative ◀──(API with a Bearer token)────── n8n   (request design · approve/reject · report · diagnostics)
```
- **Publishing always goes through the system's protected pipeline:**
  - quality checks (QC);
  - SHA-256 approval binding;
  - the kill switch and account pause;
  - provider verification (Metricool).

  n8n cannot publish directly or bypass any of these checks.
- Events are stored in a durable outbox. They are retried after 1, 5, 15, 60 and 360 minutes, so no event is lost if n8n stops temporarily.
- The two services talk internally (`http://web:3000` and `http://n8n:5678`). The traffic never leaves the server.

## Setup (once)
1. In `.env` on the server, add:
   ```
   N8N_ENCRYPTION_KEY=<output of: openssl rand -hex 32>
   TELEGRAM_BOT_TOKEN=<from @BotFather>
   TELEGRAM_CHAT_ID=<id of your group or chat>
   TELEGRAM_ALLOWED_USER_IDS=<your Telegram user id>
   ```
2. In the dashboard ← **إعدادات الربط** (Integrations) ← **n8n**:
   - Webhook URL: `http://n8n:5678/webhook/future-creative`.
   - Press **إنشاء سر توقيع الأحداث** (create event signing secret). Copy it into `.env` as `FC_WEBHOOK_SECRET=…`.
   - Press **إنشاء رمز API لـ n8n** (create n8n API token). Keep it for step 5.
   - Tick **تفعيل** (enable) and the events you want, then **حفظ** (save).
3. Start n8n:
   ```
   cd /opt/future-creative
   docker compose --profile n8n up -d
   ```
   Open `https://n8n.<DOMAIN>` and create the owner account (n8n's own sign-in).
4. Import the templates: **Workflows ← Import from File**, using the files in this folder:

   | File | What it does |
   |---|---|
   | `01-events-to-telegram.json` | Every new design reaches Telegram with its image and ✅ approve / ❌ reject buttons. Alerts for failures, uncertain results and lost connections. The weekly report every Sunday. |
   | `02-telegram-approvals.json` | Executes the button presses. Only the users in `TELEGRAM_ALLOWED_USER_IDS` can decide. |
   | `03-morning-health-check.json` | System diagnostics every day at 8:15. It sends a message only when there is a problem. |
   | `04-ideas-sheet-to-designs.json` | Every hour, reads new ideas from a Google Sheets tab named `ideas` and turns them into designs in the approval queue. |
5. Credentials in n8n:
   - **Future Creative API**: type *Header Auth*, Name `Authorization`, Value `Bearer <the token from step 2>`.
   - **Telegram FC bot**: type *Telegram API* with the bot token (only for template 02).
   - **Google Sheets**: only for template 04. After importing, choose your sheet in both Sheets nodes. Its columns: `handle | idea | format | occasion | contentType | status`.
6. To allow approval from Telegram: tick **السماح بالاعتماد/الرفض من n8n** (allow approve/reject from n8n) in the settings. It is off by default.
7. Activate the workflows. In the dashboard, press **إرسال حدث اختبار** (send test event): a test message should reach Telegram.

## The inbound API (for any additional workflows)
Base: `http://web:3000/api/integrations/n8n`, header `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/accounts` | Accounts and their connection and publishing status |
| POST | `/generate` | `{ handle \| accountId, format?, language?, productSlug?, direction: { idea, occasion, contentType, … } }` → a design in the approval queue |
| POST | `/ads/{id}/decision` | `{ decision: "approve" \| "reject", by, note? }`. Requires the setting to be enabled. |
| GET | `/reports?period=week\|month&account=` | Report from verified data |
| GET | `/diagnostics` | System diagnostics (no secrets) |
| GET | `/events` | The list of available and subscribed events |

## Event format
The request is a POST with these headers:
- `X-FC-Event`
- `X-FC-Delivery` (unique id; use it to ignore duplicates)
- `X-FC-Timestamp`
- `X-FC-Signature: sha256=HMAC(secret, "<timestamp>.<body>")`

Body:
```json
{ "id": "…", "event": "publication.published", "title": "…", "occurredAt": "…", "timezone": "Asia/Bahrain", "dashboard": "https://…", "data": { … } }
```

Events:
- `ad.ready_for_review`
- `ad.approved`
- `publication.scheduled`
- `publication.published` (only after Metricool confirms)
- `publication.failed`
- `publication.unknown`
- `connection.lost`
- `report.weekly`
- `test.ping`

## Security
- Rotating the secret or the token from the dashboard immediately invalidates the old one.
- The template's signature check rejects any tampered event, and any event older than 5 minutes (replay protection).
- No secrets are stored inside the template files.
