#!/usr/bin/env bash
# Daily DATABASE backup to Google Drive (through the Google archive script, version 2 or newer).
# Keeps only the last 3 dumps on the server; Google Drive keeps the last 30 (Settings → Integrations).
#   bash scripts/drive-backup.sh
#   cron (once):  echo '20 2 * * * root cd /opt/future-creative && bash scripts/drive-backup.sh >> /var/log/fc-drive-backup.log 2>&1' > /etc/cron.d/future-creative-drive-backup
# Restore: download every part of backups/<date>/ from Drive, join them in order (cat db-….dump.part* > db.dump),
#   then: docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < db.dump
set -euo pipefail
cd "$(dirname "$0")/.."
TS=$(date +%Y%m%d-%H%M%S)
DIR=./backups/db
mkdir -p "$DIR"
FILE="$DIR/db-$TS.dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$FILE"
SIZE=$(stat -c %s "$FILE")
[ "$SIZE" -gt 1000 ] || { echo "Database dump looks empty ($SIZE bytes) - nothing uploaded"; rm -f "$FILE"; exit 1; }
docker compose exec -T web npx tsx scripts/drive-upload.ts "$TS" "db-$TS.dump" < "$FILE"
ls -1t "$DIR"/db-*.dump 2>/dev/null | tail -n +4 | xargs -r rm -f
echo "OK: database backup $TS ($((SIZE / 1024 / 1024)) MB) is in Google Drive (archive folder/backups/$TS); last 3 kept on the server."
