#!/usr/bin/env bash
# Restores a backup created by backup.sh:  ./scripts/restore.sh backups/20261108-030000
# WARNING: replaces the current database contents and media. Stop the worker first.
set -euo pipefail
DIR="${1:?usage: restore.sh <backup-dir>}"
( cd "$DIR" && sha256sum -c SHA256SUMS )
read -r -p "This will OVERWRITE the database and media with $DIR. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "aborted"; exit 1; }
docker compose stop worker web
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < "$DIR/db.dump"
docker compose run --rm --no-deps -v "$(realpath "$DIR"):/backup" --entrypoint sh web -c 'tar -xzf /backup/media.tar.gz -C /data'
docker compose up -d web worker
echo "Restore complete."
