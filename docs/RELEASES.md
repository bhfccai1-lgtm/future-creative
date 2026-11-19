# الإصدارات والتحديث التلقائي — Releases & automatic deploy

## الطريقة (مرة واحدة على السيرفر)
```
cd /opt/future-creative
git pull
bash scripts/update.sh
bash scripts/autoupdate.sh on
```
بعدها لا تحتاج كونسول Hetzner للتحديثات.

## كل إصدار جديد
1. GitHub ← **Releases ← Draft a new release** ← اختر الوسم (مثل `v9.1.0`) ← **Publish release**.
2. خلال 10 دقائق يثبّته السيرفر بنفسه عبر `scripts/update.sh`:
   - يتحقق أن فحص GitHub (`ci-ok`) أخضر لهذا الإصدار — وإلا يرفض.
   - يبني الإصدار الجديد والنظام الحالي يعمل، ويبدّل فقط عند النجاح.
   - إن لم يجتز فحص الصحة: رجوع تلقائي، والكود يعود للإصدار العامل.
   - إصدار فشل لا يُعاد بناؤه في حلقة: إعادة محاولة كل 6 ساعات كحد أقصى.
   - يُثبَّت **الإصدار المنشور بالضبط** — لا التعديلات الأحدث غير المنشورة على main.

## أوامر
| الأمر | ماذا يفعل |
|---|---|
| `bash scripts/autoupdate.sh` | الحالة: مفعّل/متوقف، الإصدار العامل، آخر إصدار على GitHub، آخر سجل |
| `bash scripts/autoupdate.sh on` / `off` | تشغيل / إيقاف التحديث التلقائي |
| `bash scripts/update.sh` | تحديث يدوي لآخر كود على main (بنفس الحماية) |
| `bash scripts/update.sh force` | للضرورة فقط: يتجاوز فحص GitHub |

السجل: `/var/log/fc-auto-update.log` · الإصدار العامل: `/api/health`.

## For maintainers
- Add `## X.Y.Z — date (title)` to `CHANGELOG.md` and set `"version": "X.Y.Z"` in `package.json`; the Release workflow refuses a tag without both.
- Release notes are filled from the changelog even when the release is created on the GitHub website.
- How it runs: `/etc/cron.d/future-creative-releases` → `scripts/release-update.sh` every 10 min → `FC_REF=<tag> scripts/update.sh`.

## Preparing a release (one command)
```
node scripts/release-prep.mjs 9.2.0 "short title"
git commit -am "Release 9.2.0" && git push
```
Wait for the green ✓ (ci-ok) on that commit, then publish the release on GitHub with tag `v9.2.0` (the script prints the link).
New work is always written under «## Unreleased» at the top of `CHANGELOG.md`.

