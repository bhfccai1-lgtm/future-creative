#!/usr/bin/env bash
# One-time: add swap memory so the update build never starves the running system (the kernel killed ffmpeg).
#   bash scripts/swap.sh          (safe to run again — does nothing when swap already exists)
set -uo pipefail
if [ "${FC_LANG:-}" = en ] || { [ -z "${FC_LANG:-}" ] && [ "${TERM:-}" = linux ]; }; then EN=1; else EN=0; fi
t() { if [ "$EN" = 1 ]; then echo "$2"; else echo "$1"; fi; }
[ "$(id -u)" = 0 ] || { t "شغّله كمستخدم root" "Run it as root"; exit 1; }
if [ "$(free -m | awk '/^Swap/ {print $2}')" != 0 ]; then t "✓ الذاكرة الاحتياطية موجودة بالفعل:" "✓ Swap already exists:"; free -h | sed -n '1p;3p'; exit 0; fi
RAM=$(free -m | awk '/^Mem/ {print $2}')
SIZE=$(( RAM < 4096 ? 4 : 2 ))                       # 4 GB on small servers, 2 GB otherwise
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
[ "${FREE_GB:-0}" -gt $(( SIZE + 5 )) ] || { t "✗ مساحة القرص غير كافية لـ ${SIZE}GB" "✗ Not enough disk space for ${SIZE}GB swap"; exit 1; }
fallocate -l "${SIZE}G" /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=$(( SIZE * 1024 )) status=none
chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -q vm.swappiness=10 && { grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf; }
t "✓ أُضيفت ذاكرة احتياطية ${SIZE}GB (تبقى بعد إعادة التشغيل)" "✓ Added ${SIZE}GB swap (kept after reboot)"
free -h | sed -n '1,3p'
