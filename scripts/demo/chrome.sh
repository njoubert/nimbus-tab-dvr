#!/usr/bin/env bash
#
# Launch Google Chrome for the demo: a throwaway profile that still reads this Mac's Chrome
# policies, with the extension's id allowlisted for tab capture so no press of the shortcut
# is needed.
#
#   scripts/demo/chrome.sh            open the demo landing page
#   scripts/demo/chrome.sh URL...     open these instead
#
# The branded Chrome ignores --load-extension, so the extension is loaded by hand, once:
# on the first launch open chrome://extensions, turn on Developer mode, press Load unpacked
# and pick dist/extension. The profile in .build-chrome/profile remembers it; delete the
# directory to start clean. The demo itself needs `./build.sh` and `node scripts/demo/serve.mjs`
# running first.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# shellcheck source=scripts/lib/output.sh
source scripts/lib/output.sh

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$PWD/.build-chrome/profile"

install_traps "scripts/demo/chrome.sh"
[ -x "$CHROME" ] || { print_error "Google Chrome is not at $CHROME"; exit 1; }
[ -f dist/extension/manifest.json ] || { print_error "dist/extension is missing; run ./build.sh first"; exit 1; }
mkdir -p "$PROFILE"

# Chrome derives the id from the public key in the manifest: the first 16 bytes of the key's
# SHA-256, each nibble written as a letter from a to p.
extension_id=$(jq -r .key dist/extension/manifest.json | base64 -d | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')

urls=("$@")
if [ ${#urls[@]} -eq 0 ]; then
    urls=("http://localhost:5173/")
    if [ ! -d "$PROFILE/Default/Extensions" ] && [ ! -f "$PROFILE/Default/Preferences" ]; then
        urls=("chrome://extensions" "http://localhost:5173/")
        print_warning "fresh profile: load dist/extension unpacked from chrome://extensions once"
    fi
fi

print_success "launching Chrome on $PROFILE"
print_info "allowlisted extension id $extension_id"
print_info "${urls[*]}"
"$CHROME" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check \
    "--allowlisted-extension-id=$extension_id" "${urls[@]}" >/dev/null 2>&1 &
disown
result "Chrome launched"
