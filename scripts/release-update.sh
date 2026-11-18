#!/usr/bin/env bash
# Automatic release deploy — run every 10 minutes by cron once switched on with:  bash scripts/autoupdate.sh on
# When a NEW GitHub Release is published, the server updates itself to exactly that release tag through
# scripts/update.sh (which also checks the GitHub CI result, builds while the current version keeps running,
# switches only on success and rolls back automatically). Nothing happens between releases.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
exec 9>/tmp/fc-release-update.lock
flock -n 9 || exit 0                                   # an update is already running
STATE=.autoupdate-state                                # «tag result epoch» of the last attempt (git-ignored)
REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
TAG=$(curl -fsS -m 15 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag_name",""))' 2>/dev/null)
[ -n "$TAG" ] || exit 0                                # no release yet / GitHub not reachable — try again later
git fetch -q --tags origin 2>/dev/null || exit 0
SHA=$(git rev-parse "${TAG}^{commit}" 2>/dev/null) || exit 0
RUNNING=$(docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r')
[ -n "$RUNNING" ] && [ "$(git rev-parse --short "$SHA")" = "$RUNNING" ] && exit 0      # this release is already running
# the server already runs something newer that contains this release (a manual update) — leave it alone
if [ -n "$RUNNING" ] && git merge-base --is-ancestor "$SHA" HEAD 2>/dev/null && [ "$(git rev-parse --short HEAD)" = "$RUNNING" ]; then exit 0; fi
# this release failed before: retry at most every 6 hours (no endless rebuild loop)
if [ -f "$STATE" ]; then
  read -r LT LR LAT < "$STATE" || true
  if [ "${LT:-}" = "$TAG" ] && [ "${LR:-}" = fail ] && [ $(( $(date +%s) - ${LAT:-0} )) -lt 21600 ]; then exit 0; fi
fi
echo "===== $(date -Is) نشر الإصدار $TAG (${SHA:0:7}) تلقائيًا ====="
if FC_REF="$TAG" bash scripts/update.sh; then echo "$TAG ok $(date +%s)" > "$STATE"; echo "✓ $TAG يعمل"
else echo "$TAG fail $(date +%s)" > "$STATE"; echo "✗ فشل تحديث $TAG — النظام بقي على الإصدار السابق. إعادة المحاولة بعد 6 ساعات."; fi
