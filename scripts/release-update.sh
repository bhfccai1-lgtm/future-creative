#!/usr/bin/env bash
# Server update agent — run every minute by cron once switched on with:  bash scripts/autoupdate.sh on [main|button]
# (the «تحديث الخادم» button is served every minute; automatic deploys are checked every 10 minutes)
# When a NEW GitHub Release is published, the server updates itself to exactly that release tag through
# scripts/update.sh (which also checks the GitHub CI result, builds while the current version keeps running,
# switches only on success and rolls back automatically). Nothing happens between releases.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
exec 9>/tmp/fc-release-update.lock
flock -n 9 || exit 0                                   # an update is already running
STATE=.autoupdate-state                                # «tag result epoch» of the last attempt (git-ignored)
REPO=$(git remote get-url origin 2>/dev/null | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')
# ── «تحديث الخادم» button in the app (diagnostics page): the app leaves a request file in the shared media volume;
#    this agent (cron, every minute) reports that it is alive, picks the request up and writes the result back ──
SYS=/data/media/.system
running_version() { docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r'; }
put_status() { printf '{"state":"%s","at":"%s","version":"%s","message":"%s"}' "$1" "$(date -Is)" "$2" "$3" \
  | docker compose exec -T web sh -c "cat > $SYS/update-status.json" 2>/dev/null || true; }
REQ=$(docker compose exec -T web sh -c "mkdir -p $SYS && echo '$(date -Is) ${FC_FOLLOW:-release}' > $SYS/agent-heartbeat && if [ -f $SYS/update-request.json ]; then cat $SYS/update-request.json; rm -f $SYS/update-request.json; fi" 2>/dev/null)
if [ -n "$REQ" ]; then
  echo "===== $(date -Is) update requested from the app: $REQ ====="
  put_status running "$(running_version)" ""
  if bash scripts/update.sh; then V=$(running_version); put_status ok "$V" ""; echo "✓ $V running"
  else put_status fail "$(running_version)" "Update failed (GitHub CI not green, or the build failed) - see /var/log/fc-auto-update.log"; echo "✗ update failed — still on the previous version"; fi
  exit 0
fi
[ "${FC_FOLLOW:-release}" = button ] && exit 0          # button only: no automatic updates
[ $(( 10#$(date +%M) % 10 )) -eq 0 ] || exit 0          # automatic checks every 10 minutes (the agent runs every minute for the button)

# ── «main» mode (bash scripts/autoupdate.sh on main): every merge into main whose GitHub CI is green is installed ──
if [ "${FC_FOLLOW:-}" = main ]; then
  git fetch -q origin main 2>/dev/null || exit 0
  SHA=$(git rev-parse origin/main 2>/dev/null) || exit 0
  RUNNING=$(docker compose exec -T web printenv APP_VERSION 2>/dev/null | tr -d '\r')
  [ -n "$RUNNING" ] && [ "$(git rev-parse --short "$SHA")" = "$RUNNING" ] && exit 0          # already running
  # only a finished, green CI (ci-ok) — a running CI is simply picked up on a later run, a red one never installed
  CI=$(curl -fsS -m 15 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/commits/$SHA/check-runs?check_name=ci-ok" 2>/dev/null \
    | python3 -c 'import json,sys; r=json.load(sys.stdin).get("check_runs",[]); print("pending" if not r or any(x.get("status")!="completed" for x in r) else "success" if all(x.get("conclusion")=="success" for x in r) else "failure")' 2>/dev/null)
  [ "$CI" = success ] || exit 0
  TAG="main@${SHA:0:7}"
  if [ -f "$STATE" ]; then
    read -r LT LR LAT < "$STATE" || true
    if [ "${LT:-}" = "$TAG" ] && [ "${LR:-}" = fail ] && [ $(( $(date +%s) - ${LAT:-0} )) -lt 21600 ]; then exit 0; fi
  fi
  echo "===== $(date -Is) $TAG — auto deploy (follows main) ====="
  if FC_REF="$SHA" bash scripts/update.sh; then echo "$TAG ok $(date +%s)" > "$STATE"; echo "✓ $TAG running"
  else echo "$TAG fail $(date +%s)" > "$STATE"; echo "✗ $TAG failed — still on the previous version, retry in 6 h"; fi
  exit 0
fi
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
echo "===== $(date -Is) release $TAG (${SHA:0:7}) — auto deploy ====="
if FC_REF="$TAG" bash scripts/update.sh; then echo "$TAG ok $(date +%s)" > "$STATE"; echo "✓ $TAG running"
else echo "$TAG fail $(date +%s)" > "$STATE"; echo "✗ $TAG failed — still on the previous version, retry in 6 h"; fi
