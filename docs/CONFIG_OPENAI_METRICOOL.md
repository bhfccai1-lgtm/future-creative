# Configuring OpenAI and Metricool

## OpenAI
**Billing:** the OpenAI API is billed per use on platform.openai.com. It is **not** included in a ChatGPT subscription and it is not free.

1. On platform.openai.com, create a project and an API key, add a payment method, and set a usage limit on the project. That limit is a second safety net on top of this system's own cap.
2. If the account needs **organization verification** for image models (this applies to `gpt-image-1`), complete it.
3. In the dashboard go to **إعدادات الذكاء الاصطناعي**:
   * Paste the key. It is stored AES-256-GCM encrypted, and only the last 4 characters are ever shown.
   * Click **التحقق من المفتاح**, which lists the available models.
   * **Text model:** default `gpt-4.1-mini`. Any model that supports Structured Outputs (`response_format: json_schema`, strict) works.
   * **Image model:** default `gpt-image-1`, size `1024x1536`, cover-fitted to 1080×1920. Quality: `low`, `medium` or `high`.
   * **Prices:** the dashboard pricing table is used only for cost *tracking* and budget enforcement. **Update it to the current OpenAI price list.** Defaults: text $0.40/$1.60 per 1M tokens, images $0.016/$0.063/$0.25 for low/medium/high.
   * Set the monthly budget, the alert percentage, the daily ad limit and the retry count.
   * Turn **وضع التجربة (Dry-run)** off only once you are ready to spend.
4. Error handling. Each failure shows a clear Arabic notification and marks the ad FAILED:
   * `401`: invalid key
   * `429 insufficient_quota`: billing or credit problem
   * `429` (other): temporary rate limit; retried up to the configured limit
   * `400` safety/policy: rejected by content policy
   * `403`: the model is not allowed for this key or organization

## Metricool
The plan must include **API access**: the API is available on Metricool's Advanced/Custom plans. Check the current plan terms with Metricool.

1. In Metricool, create one **brand** per business identity. Connect the social profiles inside Metricool (Instagram Business/Creator through Facebook, TikTok, YouTube, and so on). This is the official OAuth step. **This system never asks for social passwords.**
2. Under Metricool **Account settings → API**, copy the **API token** and the **userId**.
3. In the dashboard go to **إعدادات الربط**: paste the token and userId, click **اختبار الاتصال**, then **جلب العلامات والشبكات المرتبطة**. The table shows the networks that Metricool *actually* reports for each brand (`blogId`).
4. For each account in **الحسابات الاجتماعية**, open the account and click **جلب العلامات من Metricool**. Choose the brand, then click **ربط الحساب والتحقق**. The status becomes **مرتبط (مؤكد)** only if Metricool lists that brand **and** reports the account's network on it.

### API details used by the adapter (`src/lib/publishing/metricool.ts`)
| Purpose | Request |
|---|---|
| Auth | header `X-Mc-Auth: <token>`, query `userId=<id>` (+ `blogId=<brand>`) |
| List brands | `GET /admin/simpleProfiles` |
| Create scheduled post | `POST /v2/scheduler/posts?blogId=` with body `{publicationDate:{dateTime (local, no offset), timezone:"Asia/Bahrain"}, text, providers:[{network}], media:[url], autoPublish:true, draft:false, instagramData:{type:"POST"\|"REEL"\|"STORY", isAiGenerated:true}, …}` |
| Get post status | `GET /v2/scheduler/posts/{id}?blogId=`; `providers[].status` = `PUBLISHED` / `ERROR` / pending, plus `publicUrl` |
| Reconcile search | `GET /v2/scheduler/posts?blogId=&start=&end=&timezone=`, matched by media URL or text |

**Verify before going live.** The request-body field names match Metricool's current scheduler schema. However, the Metricool documentation site could not be reached from the build environment, so the **endpoint paths and the exact response shapes have not been checked against a live account**. They are isolated in the `ENDPOINTS` constant and the `parseProfiles`, `extractId` and `parseStatus` helpers. Run one test post (checklist step 7) and adjust those helpers if the responses differ. Until that is done, the safety logic still holds: anything ambiguous becomes `UNKNOWN`, never `PUBLISHED`.

### Media delivery
Metricool downloads media from `PUBLIC_BASE_URL/api/public-media?...`. These URLs are HMAC-signed and expire after 7 days. `PUBLIC_BASE_URL` must therefore be the real HTTPS domain, reachable from the internet. Still images are exported as JPEG, the only still format Instagram's publishing API accepts. Reels are H.264/AAC MP4 at 1080×1920 with faststart.

### Rate limits
The shared Redis limiter defaults to 30 requests per minute per provider (configurable). A provider `429` re-queues the job with `Retry-After`.
