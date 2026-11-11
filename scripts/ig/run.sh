#!/usr/bin/env bash
# Runs the operator CLI in the right place: inside the worker container on the server, locally otherwise.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -f docker-compose.yml ] && command -v docker >/dev/null 2>&1 && docker compose ps --status running worker 2>/dev/null | grep -q worker; then
  exec docker compose exec -T worker npx tsx scripts/ig/cli.ts "$@"
fi
exec npx tsx scripts/ig/cli.ts "$@"
