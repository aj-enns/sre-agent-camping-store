#!/usr/bin/env bash
set -euo pipefail

case "${RESTORE_LIVE_REPORT:-false}" in
  false|'') echo "Live report recreation is disabled (RESTORE_LIVE_REPORT=true to enable)."; exit 0 ;;
  true) ;;
  *) echo "ERROR: RESTORE_LIVE_REPORT must be true or false." >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
for python in python python3; do
  if command -v "$python" >/dev/null 2>&1 &&
      "$python" -c 'import sys; sys.exit(sys.version_info[0] != 3)' >/dev/null 2>&1; then
    exec "$python" "$SCRIPT_DIR/restore-live-report.py"
  fi
done
echo "ERROR: Python 3 is required for live report recreation." >&2
exit 1
