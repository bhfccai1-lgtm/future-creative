#!/usr/bin/env bash
# Safe one-command update for the Future Creative server.
#   Usage (inside /opt/future-creative):   bash scripts/update.sh
# 1) pulls the latest code   2) builds the new version WHILE the current one keeps running
# 3) only if the build succeeds: switches over and waits for the health check
# 4) if the new version does not become healthy: rolls back to the previous image automatically.
set -uo pipefail
# run from a copy: `git pull` may replace this very file while it is running
if [ -z "${FC_REPO:-}" ]; then
  FC_REPO="$(cd "$(dirname "$0")/.." && pwd)"; export FC_REPO
  cp "$0" /tmp/fc-update-run.sh && exec bash /tmp/fc-update-run.sh "$@"
fi
cd "$FC_REPO" || exit 1

G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; N='\033[0m'
ok()   { echo -e "${G}✓ $*${N}"; }
fail() { echo -e "${R}✗ $*${N}"; }
step() { echo -e "${Y}==> $*${N}"; }
LOG=/tmp/fc-update.log
: > "$LOG"

step "التحديث يبدأ — النظام الحالي يبقى يعمل حتى ينجح البناء"
OLD=$(git rev-parse --short HEAD)
if ! git pull --ff-only >>"$LOG" 2>&1; then
  fail "فشل تنزيل التحديث (git pull). آخر سطور السجل:"; tail -15 "$LOG"; exit 1
fi
NEW=$(git rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ] && [ "${1:-}" != "force" ]; then
  RUNNING=$(docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r')
  if [ "$RUNNING" = "$NEW" ]; then ok "النظام محدّث بالفعل — الإصدار $NEW"; exit 0; fi
  step "الكود محدّث لكن الإصدار العامل ($RUNNING) مختلف — سيُعاد البناء"
fi
echo "   من $OLD إلى $NEW"
git log --oneline "$OLD..$NEW" 2>/dev/null | head -15 | sed 's/^/   • /'

export GIT_SHA="$NEW" BUILD_TIME="$(TZ=Asia/Bahrain date '+%Y-%m-%d %H%M')"
docker image inspect future-creative-app:latest >/dev/null 2>&1 && docker tag future-creative-app:latest future-creative-app:previous

step "بناء الإصدار الجديد (قد يستغرق 3–8 دقائق)..."
if ! docker compose build >>"$LOG" 2>&1; then
  fail "فشل البناء — لم يتغير شيء، النظام مستمر على الإصدار السابق ($OLD)."
  echo "   صوّر هذه السطور وأرسلها للدعم:"; grep -iE "error|failed" "$LOG" | tail -12; exit 1
fi
ok "نجح البناء"

step "تشغيل الإصدار الجديد (الترحيلات ثم الويب والعامل)..."
docker compose up -d >>"$LOG" 2>&1

step "انتظار فحص الصحة..."
HEALTHY=0
for i in $(seq 1 "${FC_HEALTH_TRIES:-40}"); do
  if docker compose exec -T web node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 5
done

if [ "$HEALTHY" = "1" ]; then
  ok "تم التحديث بنجاح — الإصدار $NEW يعمل"
  docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
  if docker compose --profile n8n ps -q n8n 2>/dev/null | grep -q .; then echo "   n8n يعمل. لتحديث قوالبه: bash scripts/n8n-setup.sh"; fi
  exit 0
fi

fail "الإصدار الجديد لم يجتز فحص الصحة خلال 3 دقائق — رجوع تلقائي للإصدار السابق ($OLD)"
docker compose logs --tail=25 web worker migrate 2>/dev/null | tail -30
if docker image inspect future-creative-app:previous >/dev/null 2>&1; then
  docker tag future-creative-app:previous future-creative-app:latest
  docker compose up -d --no-build --no-deps web worker >>"$LOG" 2>&1 && ok "رجع النظام للإصدار السابق"
fi
echo "   صوّر هذه الشاشة وأرسلها للدعم."
exit 1
