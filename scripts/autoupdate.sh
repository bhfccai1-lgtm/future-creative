#!/usr/bin/env bash
# Automatic deploy of GitHub Releases on this server.
#   bash scripts/autoupdate.sh on       → every 10 minutes: a new Release on GitHub is installed automatically
#   bash scripts/autoupdate.sh off      → back to manual updates (bash scripts/update.sh)
#   bash scripts/autoupdate.sh          → status: on/off, running version, latest release, last log lines
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DIR=$(pwd)
CRON=/etc/cron.d/future-creative-releases
LOGF=/var/log/fc-auto-update.log
G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; N='\033[0m'
case "${1:-status}" in
  on)
    [ -d /etc/cron.d ] || { echo -e "${R}cron غير مثبت على السيرفر: apt-get install -y cron${N}"; exit 1; }
    command -v python3 >/dev/null && command -v curl >/dev/null && command -v flock >/dev/null || { echo -e "${R}يحتاج python3 و curl و flock: apt-get install -y python3 curl util-linux${N}"; exit 1; }
    printf '%s\n' '# Future Creative: install new GitHub Releases automatically (bash scripts/autoupdate.sh off to stop)' \
      'SHELL=/bin/bash' 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
      "*/10 * * * * root cd $DIR && bash scripts/release-update.sh >> $LOGF 2>&1" > "$CRON"
    chmod 644 "$CRON"; touch "$LOGF"
    echo -e "${G}✓ التحديث التلقائي للإصدارات مفعّل${N}"
    echo "   كل 10 دقائق: إذا نُشر إصدار جديد على GitHub (Releases ← Publish release) يُثبَّت تلقائيًا."
    echo "   الحماية كما هي: فحص GitHub الأخضر، البناء والنظام يعمل، والرجوع التلقائي عند أي مشكلة."
    echo "   السجل: bash scripts/autoupdate.sh"
    ;;
  off)
    rm -f "$CRON"; echo -e "${Y}أُوقف التحديث التلقائي — التحديث يدويًا: bash scripts/update.sh${N}" ;;
  status|*)
    if [ -f "$CRON" ]; then echo -e "${G}التحديث التلقائي للإصدارات: مفعّل${N}"; else echo -e "${Y}التحديث التلقائي للإصدارات: متوقف (للتفعيل: bash scripts/autoupdate.sh on)${N}"; fi
    echo "   الإصدار العامل: $(docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r')"
    REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
    echo "   آخر إصدار على GitHub: $(curl -fsS -m 10 "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag_name","—"))' 2>/dev/null || echo '—')"
    [ -f .autoupdate-state ] && echo "   آخر محاولة: $(cat .autoupdate-state | awk '{ printf "%s — %s", $1, ($2=="ok"?"نجحت":"فشلت") }')"
    [ -s "$LOGF" ] && { echo "   آخر السجل:"; grep -E "=====|✓|✗" "$LOGF" | tail -6 | sed 's/^/     /'; }
    ;;
esac
