#!/bin/bash
# ════════════════════════════════════════════════════════════════════════
#  FUTURE CREATIVE AI PUBLISHING SYSTEM — automatic install (Hetzner Cloud config)
#  Option A: paste into "Cloud config" when creating an Ubuntu 24.04 server.
#  Option B (existing server, public repo):  wget <raw-url-of-this-file>  then  bash hetzner-cloud-init.sh
#  Values left as placeholders are handled automatically (public clone, generated admin password).
#  Progress log on the server: /var/log/fc-install.log
# ════════════════════════════════════════════════════════════════════════
GITHUB_TOKEN="PASTE_GITHUB_TOKEN_HERE"        # fine-grained token, read-only "Contents" for this repo
ADMIN_EMAIL="admin@futurecreative.bh"         # dashboard login email
ADMIN_PASSWORD="CHANGE-ME-Strong-2026"        # dashboard password: 12+ chars, letters AND digits
ACME_EMAIL="you@example.com"                  # your email (for the free HTTPS certificate)
REPO="bhfccai1-lgtm/future-creative"
# ════════════════════════════════════════════════════════════════════════

set -euo pipefail
exec > >(tee -a /var/log/fc-install.log) 2>&1
echo "=== start $(date -u)"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y install git curl ufw openssl ca-certificates
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

APP=/opt/future-creative
if [ ! -d "$APP/.git" ]; then
  if [ "$GITHUB_TOKEN" = "PASTE_GITHUB_TOKEN_HERE" ] || [ -z "$GITHUB_TOKEN" ]; then
    git clone "https://github.com/${REPO}.git" "$APP"                  # public repository
  else
    git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git" "$APP"
    git -C "$APP" remote set-url origin "https://github.com/${REPO}.git"   # do not keep the token on disk
  fi
fi
cd "$APP"

if [ "$ADMIN_PASSWORD" = "CHANGE-ME-Strong-2026" ] || [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="Fc-$(openssl rand -hex 6)-2026"
fi
[ "$ACME_EMAIL" = "you@example.com" ] && ACME_EMAIL=""

IP=$(curl -4 -fsS https://api.ipify.org)
DOMAIN="$(echo "$IP" | tr . -).sslip.io"

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's/[[:space:]]\+#.*$//' .env
  set_kv() { sed -i "s|^$1=.*|$1=$2|" .env; }
  set_kv PUBLIC_BASE_URL "https://${DOMAIN}"
  set_kv DOMAIN "${DOMAIN}"
  set_kv ACME_EMAIL "${ACME_EMAIL}"
  set_kv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_kv APP_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_kv SESSION_SECRET "$(openssl rand -hex 32)"
  set_kv COOKIE_SECURE "true"
  set_kv ADMIN_EMAIL "${ADMIN_EMAIL}"
  set_kv ADMIN_PASSWORD "${ADMIN_PASSWORD}"
  chmod 600 .env
fi

docker compose up -d --build

for i in $(seq 1 20); do
  if docker compose run --rm web npm run admin:create; then break; fi
  echo "admin:create not ready yet, retry $i"; sleep 15
done

# remove the admin password from .env once the account exists
sed -i 's|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=|' .env

printf 'URL:      https://%s\nEmail:    %s\nPassword: %s\n' "$DOMAIN" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" > /root/SITE-LOGIN.txt
chmod 600 /root/SITE-LOGIN.txt
echo
echo "════════════════════════════════════════════"
echo "  DONE  $(date -u)"
cat /root/SITE-LOGIN.txt
echo "  (saved in /root/SITE-LOGIN.txt)"
echo "════════════════════════════════════════════"
