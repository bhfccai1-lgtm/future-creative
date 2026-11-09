# Checklist: activating production publishing

Work through these steps **in order**. Do not skip ahead to automation. The system starts in MANUAL mode with auto-publishing **off**, and it stays that way until an administrator changes it.

### A. Infrastructure
- [ ] 1. Deploy as described in `DEPLOYMENT_UBUNTU.md`. `https://<domain>/api/health` returns `{"ok":true}`.
- [ ] 2. `.env` has fresh `APP_ENCRYPTION_KEY`, `SESSION_SECRET` and `POSTGRES_PASSWORD`; `COOKIE_SECURE=true`; `PUBLIC_BASE_URL` set to the real HTTPS URL. The encryption key is backed up offline.
- [ ] 3. The admin account has been created and `ADMIN_PASSWORD` removed from `.env`. A second admin exists for emergencies.
- [ ] 4. A backup cron job is installed, and one restore has been tested on a staging server.

### B. Brand
- [ ] 5. **إعدادات الهوية**: upload the ORIGINAL transparent PNG logo, approve it, and record the SHA-256 shown.
- [ ] 6. Verify the company names, the CTAs (اطلب الآن / Order Now / Malayalam), and the phone numbers: **Saar 33316319** and **Salmabad 34315316**.

### C. Previews (no cost)
- [ ] 7. With **Dry-run ON**, generate one ad per language and per format (image and Reel) in **إنشاء تصميم جديد**. Inspect every preview: logo undistorted, Arabic shaping correct, numbers correct, nothing clipped. Have a native speaker review the Malayalam.

### D. OpenAI
- [ ] 8. Add the API key, then click **التحقق من المفتاح**. Set the monthly budget and the project usage limit in OpenAI as well, and update the pricing table.
- [ ] 9. Turn Dry-run **OFF**. Generate 3 real ads. Check quality, the QC report and the recorded cost on **تحليلات الأداء**.

### E. Metricool (one account first)
- [ ] 10. Enter the token and userId, then **اختبار الاتصال** succeeds and **جلب العلامات** lists the expected networks.
- [ ] 11. Connect **one** test account; its status reads **مرتبط (مؤكد)**.
- [ ] 12. Approve one real ad and click **نشر الآن**. Then confirm:
  - the post appears in Metricool's planner at the expected Bahrain time (it is scheduled ~20 min ahead by default);
  - after the publication time, the system changes the job to **منشور (مؤكد)** with a public URL;
  - if the job stays SCHEDULED or becomes UNKNOWN, compare Metricool's real response (in **سجل المنشورات → محاولات النشر**) with the parsers in `src/lib/publishing/metricool.ts` and adjust them. **Do not proceed until this works.**
- [ ] 13. Test a Reel the same way, plus each other network you intend to use (Facebook, TikTok, …).

### F. Assisted operation (recommended for 1–2 weeks)
- [ ] 14. Connect the remaining accounts and set each one's language, products, format, interval and window.
- [ ] 15. Switch to **ASSISTED** and click **تشغيل النشر الآلي**. Only accounts with **السماح بالنشر الآلي** enabled are scheduled. Review the approval queue daily.
- [ ] 16. Watch **الأخطاء والتنبيهات**, the budget gauge and the UNKNOWN count.

### G. Autonomous (optional)
- [ ] 17. Practise the **⛔ إيقاف طارئ** kill switch and confirm that publishing stops.
- [ ] 18. Switch to **AUTONOMOUS** (type the confirmation phrase), then authorise **only** the selected accounts on each account page.
- [ ] 19. Review the audit log weekly. Revoke authorisation for any account showing problems.
