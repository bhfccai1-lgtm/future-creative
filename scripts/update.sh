#!/usr/bin/env bash
# Safe one-command update for the Future Creative server.
#   Usage (inside /opt/future-creative):   bash scripts/update.sh
#   FC_REF=v9.1.0 bash scripts/update.sh   → update to that exact release tag (used by the automatic release deploy)
# 1) pulls the latest code   2) builds the new version WHILE the current one keeps running
# 3) only if the build succeeds: switches over and waits for the health check
# 4) if the new version does not become healthy: rolls back to the previous image automatically.
# 0) before pulling: waits for / checks the GitHub CI result (ci-ok) of the new version and refuses a red one ('force' skips).
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
OLD_FULL=$(git rev-parse HEAD)

# ── GitHub CI guard: update only to a version whose CI check (ci-ok) is green. «bash scripts/update.sh force» skips it. ──
ci_state() { # prints success | failure | pending | unknown  for commit $1 (public repo: no token needed)
  local repo url
  repo=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
  [ -n "$repo" ] || { echo unknown; return; }
  url="https://api.github.com/repos/$repo/commits/$1/check-runs?per_page=100"
  curl -fsS -m 15 -H 'Accept: application/vnd.github+json' "$url" 2>/dev/null | python3 -c '
import json,sys
try: runs=json.load(sys.stdin).get("check_runs",[])
except Exception: print("unknown"); sys.exit()
ci=[r for r in runs if r.get("name")=="ci-ok"] or [r for r in runs if r.get("name") in ("build","docker") or str(r.get("name","")).startswith("integration")]
if not ci: print("unknown")
elif any(r.get("status")!="completed" for r in ci): print("pending")
elif all(r.get("conclusion")=="success" for r in ci): print("success")
else: print("failure")' 2>/dev/null || echo unknown
}
if [ "${1:-}" != "force" ] && command -v python3 >/dev/null && command -v curl >/dev/null && git fetch -q --tags origin 2>>"$LOG"; then
  if [ -n "${FC_REF:-}" ]; then TARGET=$(git rev-parse "${FC_REF}^{commit}" 2>/dev/null || echo ""); else TARGET=$(git rev-parse "@{u}" 2>/dev/null || echo ""); fi
  RUNNING_NOW=$(docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r')
  # compare with the version that RUNS (not the checked-out code: a failed earlier attempt may have pulled already)
  if [ -n "$TARGET" ] && [ "$(git rev-parse --short "$TARGET")" != "$RUNNING_NOW" ]; then
    step "فحص GitHub للإصدار ${TARGET:0:7} قبل التحديث..."
    for i in $(seq 1 40); do
      ST=$(ci_state "$TARGET")
      [ "$ST" = pending ] || break
      [ "$i" = 1 ] && echo "   فحص GitHub ما زال يعمل — أنتظر حتى ينتهي (حتى 20 دقيقة)..."
      sleep 30
    done
    case "$ST" in
      success) ok "فحص GitHub ناجح ✓" ;;
      failure) fail "فحص GitHub فشل لهذا الإصدار — لم يُحدَّث شيء، النظام مستمر على $OLD."; echo "   انتظر إصلاحًا جديدًا ثم أعد المحاولة (أو للضرورة فقط: bash scripts/update.sh force)"; exit 1 ;;
      pending) fail "فحص GitHub لم ينتهِ بعد 20 دقيقة — لم يُحدَّث شيء. أعد المحاولة لاحقًا."; exit 1 ;;
      *) echo "   تعذّر التحقق من GitHub (لا اتصال؟) — سيستمر التحديث، والرجوع التلقائي يحمي النظام." ;;
    esac
  fi
fi
if [ -n "${FC_REF:-}" ]; then PULL=(bash -c "git fetch -q --tags origin && git merge --ff-only \"\$0\"" "$FC_REF"); else PULL=(git pull --ff-only); fi
if ! "${PULL[@]}" >>"$LOG" 2>&1; then
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
  git reset -q --keep "$OLD_FULL" 2>/dev/null || true   # code back to the running version (the next try checks GitHub again)
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
  git reset -q --keep "$OLD_FULL" 2>/dev/null || true
  docker compose up -d --no-build --no-deps web worker >>"$LOG" 2>&1 && ok "رجع النظام للإصدار السابق"
fi
echo "   صوّر هذه الشاشة وأرسلها للدعم."
exit 1
