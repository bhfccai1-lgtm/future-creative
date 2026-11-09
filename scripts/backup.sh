#!/usr/bin/env bash
# Backs up PostgreSQL + media volume into ./backups/<timestamp>/ . Run from the project directory.
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
OUT="./backups/$TS"
mkdir -p "$OUT"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$OUT/db.dump"
docker compose run --rm --no-deps -v "$(pwd)/$OUT:/backup" --entrypoint sh web -c 'tar -czf /backup/media.tar.gz -C /data media'
sha256sum "$OUT"/* > "$OUT/SHA256SUMS"
# keep the last 14 backups
ls -1dt ./backups/*/ | tail -n +15 | xargs -r rm -rf
echo "Backup written to $OUT"
