#!/usr/bin/env bash
# Automatic deploy of GitHub Releases on this server.
#   bash scripts/autoupdate.sh on       → every 10 minutes: a new Release on GitHub is installed automatically
#   bash scripts/autoupdate.sh on main  → every 10 minutes: every merge into main with a green GitHub CI is installed
#   bash scripts/autoupdate.sh off      → back to manual updates (bash scripts/update.sh)
#   bash scripts/autoupdate.sh          → status: on/off, running version, latest release, last log lines
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
DIR=$(pwd)
CRON=/etc/cron.d/future-creative-releases
LOGF=/var/log/fc-auto-update.log
G='\033[1;32m'; R='\033[1;31m'; Y='\033[1;33m'; N='\033[0m'
# Hetzner web console (TERM=linux) cannot draw Arabic → English there
if [ "${FC_LANG:-}" = en ] || { [ -z "${FC_LANG:-}" ] && [ "${TERM:-}" = linux ]; }; then EN=1; else EN=0; fi
t() { if [ "$EN" = 1 ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
case "${1:-status}" in
  on)
    [ -d /etc/cron.d ] || { echo -e "${R}$(t "cron غير مثبت على السيرفر" "cron is not installed"): apt-get install -y cron${N}"; exit 1; }
    command -v python3 >/dev/null && command -v curl >/dev/null && command -v flock >/dev/null || { echo -e "${R}$(t "يحتاج python3 و curl و flock" "needs python3, curl and flock"): apt-get install -y python3 curl util-linux${N}"; exit 1; }
    printf '%s\n' '# Future Creative: install new GitHub Releases automatically (bash scripts/autoupdate.sh off to stop)' \
      'SHELL=/bin/bash' 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
      "*/10 * * * * root cd $DIR && FC_LANG=en FC_FOLLOW=${2:-release} bash scripts/release-update.sh >> $LOGF 2>&1" > "$CRON"
    chmod 644 "$CRON"; touch "$LOGF"
    if [ "${2:-}" = main ]; then
      echo -e "${G}✓ $(t "التحديث التلقائي مفعّل — يتبع main" "Automatic updates are ON — following main")${N}"
      echo "   $(t "كل 10 دقائق: كل دمج في main نجح فحصه على GitHub يُثبَّت تلقائيًا." "Every 10 minutes: every merge into main with a green GitHub CI is installed automatically.")"
    else
      echo -e "${G}✓ $(t "التحديث التلقائي للإصدارات مفعّل" "Automatic release updates are ON")${N}"
      echo "   $(t "كل 10 دقائق: إذا نُشر إصدار جديد على GitHub يُثبَّت تلقائيًا." "Every 10 minutes: a newly published GitHub Release is installed automatically.")"
    fi
    echo "   $(t "الحماية كما هي: فحص GitHub الأخضر، البناء والنظام يعمل، والرجوع التلقائي." "Same safety: green GitHub CI, build while running, automatic rollback.")"
    echo "   $(t "الحالة والسجل" "Status and log"): bash scripts/autoupdate.sh"
    ;;
  off)
    rm -f "$CRON"; echo -e "${Y}$(t "أُوقف التحديث التلقائي — التحديث يدويًا" "Automatic updates OFF — update manually"): bash scripts/update.sh${N}" ;;
  status|*)
    if [ -f "$CRON" ] && grep -q 'FC_FOLLOW=main' "$CRON"; then echo -e "${G}$(t "التحديث التلقائي: مفعّل — يتبع main" "Automatic updates: ON — following main")${N}"
    elif [ -f "$CRON" ]; then echo -e "${G}$(t "التحديث التلقائي للإصدارات: مفعّل" "Automatic release updates: ON")${N}"; else echo -e "${Y}$(t "التحديث التلقائي للإصدارات: متوقف" "Automatic release updates: OFF") (bash scripts/autoupdate.sh on)${N}"; fi
    echo "   $(t "الإصدار العامل" "Running version"): $(docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r')"
    REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
    echo "   $(t "آخر إصدار على GitHub" "Latest GitHub release"): $(curl -fsS -m 10 "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag_name","—"))' 2>/dev/null || echo '—')"
    [ -f .autoupdate-state ] && echo "   $(t "آخر محاولة" "Last attempt"): $(awk '{ print $1, $2 }' .autoupdate-state)"
    [ -s "$LOGF" ] && { echo "   $(t "آخر السجل" "Last log lines"):"; grep -E "=====|✓|✗" "$LOGF" | tail -6 | sed 's/^/     /'; }
    ;;
esac
