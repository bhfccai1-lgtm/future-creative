#!/usr/bin/env bash
# One-command n8n setup on the Future Creative server (no secrets typed in the console):
#   bash scripts/n8n-setup.sh
# 1) reads/creates the n8n secrets from the dashboard settings  2) writes them to .env (chmod 600)
# 3) starts n8n  4) imports the templates (+ Telegram credential)  5) publishes them  6) sends a test event
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "ملف .env غير موجود في $(pwd)"; exit 1; }
say() { printf '\n\033[1;33m%s\033[0m\n' "$*"; }

say "1/6 قراءة الإعدادات من لوحة التحكم…"
vals=$(docker compose exec -T worker npx tsx scripts/ig/n8n-env.ts --enable)

say "2/6 تحديث ملف .env…"
setenv() { local k="$1" v="$2"; if grep -q "^$k=" .env; then sed -i "s|^$k=.*|$k=$v|" .env; else printf '%s=%s\n' "$k" "$v" >> .env; fi; }
while IFS='=' read -r k v; do [ -n "${k:-}" ] && setenv "$k" "$v"; done <<< "$vals"
if ! grep -qE '^N8N_ENCRYPTION_KEY=.+' .env; then setenv N8N_ENCRYPTION_KEY "$(openssl rand -hex 32)"; echo "   أُنشئ N8N_ENCRYPTION_KEY (احتفظ بنسخة من .env)"; fi
chmod 600 .env
TG=$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2-)

say "3/6 تشغيل n8n…"
docker compose --profile n8n up -d n8n
docker compose restart caddy >/dev/null
for i in $(seq 1 60); do docker compose exec -T n8n node -e "fetch('http://localhost:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break; sleep 3; done
docker compose exec -T n8n node -e "fetch('http://localhost:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 || { echo "n8n لم يبدأ — راجع: docker compose logs --tail=50 n8n"; exit 1; }

say "4/6 استيراد القوالب…"
for f in 05-error-alerts 01-events-to-telegram 03-morning-health-check 02-telegram-bot 04-ideas-sheet-to-designs 06-archive-to-google-drive-sheets; do
  docker compose exec -T n8n n8n import:workflow --input="/templates/$f.json" >/dev/null 2>&1 && echo "   ✓ $f" || echo "   ✗ $f"
done
if [ -n "$TG" ]; then
  printf '[{"id":"fctelegrambot001","name":"Telegram FC bot","type":"telegramApi","data":{"accessToken":"%s"}}]' "$TG" | docker compose exec -T n8n sh -c 'cat > /tmp/fc-cred.json && n8n import:credentials --input=/tmp/fc-cred.json >/dev/null 2>&1; rm -f /tmp/fc-cred.json' && echo "   ✓ بيانات دخول بوت تيليجرام"
fi

say "5/6 تفعيل القوالب…"
pub() { docker compose exec -T n8n n8n publish:workflow --id="$1" >/dev/null 2>&1 && echo "   ✓ $2" || echo "   ✗ $2"; }
pub ee8f61980fec7152 "تنبيهات الأخطاء"
pub 17c4a16cbc23e9ea "الأحداث ← تيليجرام"
pub 040ef7dda8d153f5 "فحص الصباح"
[ -n "$TG" ] && pub d710aa8879acde85 "بوت تيليجرام (أزرار + أوامر)"
echo "   (قالبا Google Sheets/Drive يحتاجان ربط حساب Google من محرر n8n ثم تفعيلهما يدويًا)"
docker compose restart n8n >/dev/null
for i in $(seq 1 60); do docker compose exec -T n8n node -e "fetch('http://localhost:5678/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break; sleep 3; done
sleep 5

say "6/6 إرسال حدث اختبار…"
docker compose exec -T worker npx tsx scripts/ig/n8n-env.ts --test
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2-)
say "تم ✓  محرر n8n: https://n8n.${DOMAIN}  (أول مرة: أنشئ حساب المالك)"
[ -z "$TG" ] && echo "ملاحظة: لم يُضبط بوت تيليجرام — أضفه من إعدادات الربط ثم أعد تشغيل هذا الأمر."
exit 0
