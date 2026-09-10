#!/usr/bin/env bash
#
# Launch Google Chrome on a throwaway profile that still reads this Mac's Chrome policies, so
# the force-installed extension can be tried without touching the everyday profile.
#
#   scripts/spike/chrome.sh            open the demo landing page
#   scripts/spike/chrome.sh URL...     open these instead
#
# The profile lives in .build-chrome/profile; delete the directory to start clean.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# shellcheck source=scripts/lib/output.sh
source scripts/lib/output.sh

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$PWD/.build-chrome/profile"

install_traps "scripts/spike/chrome.sh"
[ -x "$CHROME" ] || { print_error "Google Chrome is not at $CHROME"; exit 1; }
mkdir -p "$PROFILE"

urls=("$@")
[ ${#urls[@]} -gt 0 ] || urls=("http://localhost:5173/")

print_success "launching Chrome on $PROFILE"
print_info "${urls[*]}"
"$CHROME" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check "${urls[@]}" >/dev/null 2>&1 &
disown
result "Chrome launched"
