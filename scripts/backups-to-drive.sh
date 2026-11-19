#!/usr/bin/env bash
# Moves OLD full backups (backups/2*/) to Google Drive, then deletes them from the server — only after Google Drive
# confirmed every byte of every file. The newest backup stays on the server.
#   bash scripts/backups-to-drive.sh            → moves all but the newest backup
#   KEEP=2 bash scripts/backups-to-drive.sh     → keeps the newest 2 on the server
# Needs: the Google archive connected (Settings → Integrations) with the script version 2 or newer.
# Restore from Drive: download backups/<date>/, join the parts in order (cat media.tar.gz.part* > media.tar.gz), then scripts/restore.sh.
set -uo pipefail
cd "$(dirname "$0")/.."
KEEP=${KEEP:-1}
mapfile -t OLD < <(ls -1dt ./backups/2*/ 2>/dev/null | tail -n +$((KEEP + 1)))
[ ${#OLD[@]} -gt 0 ] || { echo "Nothing to move (only $KEEP backup(s) on the server)."; exit 0; }
echo "Moving ${#OLD[@]} old backup(s) to Google Drive (keeping the newest $KEEP on the server)..."
for DIR in "${OLD[@]}"; do
  NAME=$(basename "$DIR"); OK=1
  for F in "$DIR"*; do
    [ -f "$F" ] || continue
    SIZE=$(stat -c %s "$F"); FILE=$(basename "$F")
    echo "  $NAME/$FILE ($((SIZE / 1024 / 1024)) MB)..."
    OUT=$(docker compose exec -T web npx tsx scripts/drive-upload.ts "$NAME" "$FILE" < "$F" 2>&1) || { echo "    FAILED: $OUT"; OK=0; break; }
    GOT=$(echo "$OUT" | sed -n 's/^UPLOADED //p' | tail -1)
    [ "$GOT" = "$SIZE" ] || { echo "    size check failed (server $SIZE, Drive ${GOT:-?}) - kept on the server"; OK=0; break; }
  done
  if [ $OK = 1 ]; then rm -rf "$DIR"; echo "  OK: $NAME is in Google Drive (archive folder/backups/$NAME) and was removed from the server."; else echo "  KEPT: $NAME stays on the server."; fi
done
df -h / | tail -1
