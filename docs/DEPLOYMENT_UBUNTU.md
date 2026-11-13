# Deployment: Ubuntu 24.04 LTS (Docker Compose)

## 1. Server
* Minimum 2 vCPU, 4 GB RAM and 40 GB SSD. 4 vCPU / 8 GB is recommended if you produce many Reels, because each 12-second Reel takes about 20–30 s of CPU.
* A DNS `A` record for your domain (for example `ads.example.bh`) pointing at the server.
* Firewall: open only ports 22, 80 and 443.
```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl git ufw
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
# Docker Engine + compose plugin (official repository)
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update && sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER   # log out/in
```

## 2. Configure
```bash
git clone <your-repo> /opt/future-creative && cd /opt/future-creative
cp .env.example .env && chmod 600 .env
# Fill in .env:
#   DOMAIN, ACME_EMAIL, PUBLIC_BASE_URL=https://<DOMAIN>
#   POSTGRES_PASSWORD=$(openssl rand -hex 24)
#   APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   SESSION_SECRET=$(openssl rand -base64 48)
#   COOKIE_SECURE=true
```
Keep `APP_ENCRYPTION_KEY` safe and **back it up separately**. Without it, the API keys stored in the database cannot be decrypted.

## 3. Start
```bash
docker compose up -d --build          # postgres, redis, migrate (+seed), web, worker, caddy
docker compose ps                     # all healthy; "migrate" exits 0
docker compose run --rm web npm run admin:create   # uses ADMIN_EMAIL / ADMIN_PASSWORD from .env
# then remove ADMIN_PASSWORD from .env
curl -fsS https://<DOMAIN>/api/health  # {"ok":true,...}
```
Caddy obtains and renews the Let's Encrypt certificate automatically. The database and Redis are not exposed outside the Docker network.

## 4. First configuration (in the dashboard)
Follow `docs/ar/ADMIN_GUIDE_AR.md` and `docs/PRODUCTION_CHECKLIST.md`: logo, then AI settings, then Metricool, then accounts, then previews, then approval tests, and only then automation.

## 5. Operations
| Task | Command |
|---|---|
| Logs | `docker compose logs -f worker` / `web` |
| Restart worker (safe; recovery runs on start) | `docker compose restart worker` |
| Upgrade | `bash scripts/update.sh` — pulls, builds while the old version keeps running, switches only if the build succeeds, waits for the health check and rolls back automatically if needed (migrations run through the `migrate` service). Check the ✓ on the commit in GitHub Actions first. |
| Backup (DB + media) | `./scripts/backup.sh`; add to cron, e.g. `15 2 * * * cd /opt/future-creative && ./scripts/backup.sh >> backups/cron.log 2>&1` |
| Restore | `./scripts/restore.sh backups/<timestamp>` (asks for confirmation, then overwrites) |
| Off-site copy | sync `backups/` to external storage, e.g. `rclone` to S3 or Google Drive |
| Emergency stop | Dashboard: **⛔ إيقاف طارئ فوري**, or `docker compose stop worker` |

Restore procedure test: restore a backup into a staging server at least once a quarter.

## 6. Optional S3 / MinIO media storage
Set `STORAGE_DRIVER=s3` and the `S3_*` variables, then run `docker compose --profile s3 up -d`. Create the bucket and keep it **private**. Providers receive signed `/api/public-media` URLs from the app, so the bucket never needs public access.

## 7. Resource notes
* The worker runs generation with `WORKER_CONCURRENCY` (default 2) and publishing with concurrency 1.
* Redis runs with AOF persistence and `noeviction`, as BullMQ requires.
* Container logs rotate at 20 MB × 5 files.
