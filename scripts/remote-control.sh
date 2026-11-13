#!/usr/bin/env bash
# Lets your Claude Code cloud session work directly in this server folder (Remote Control).
#   Usage (inside /opt/future-creative):   bash scripts/remote-control.sh
# Keep this console open while Claude works. Stop any time with Ctrl+C.
# Every connection must be approved by you in the Claude app; nothing runs without it.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
export PATH="$HOME/.local/bin:$PATH"
if ! command -v claude >/dev/null 2>&1; then
  echo "==> تثبيت Claude Code (مرة واحدة فقط)..."
  curl -fsSL https://claude.ai/install.sh | bash || { echo "✗ فشل التثبيت"; exit 1; }
  export PATH="$HOME/.local/bin:$PATH"
fi
echo "==> تشغيل الربط من المجلد: $(pwd)"
echo "   إن طُلب تسجيل الدخول: افتح الرابط الظاهر في هاتفك وسجّل بحساب Claude نفسه."
echo "   أبقِ هذه الشاشة مفتوحة أثناء العمل. للإيقاف: Ctrl+C"
exec claude remote-control
