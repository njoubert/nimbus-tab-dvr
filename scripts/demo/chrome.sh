#!/usr/bin/env bash
#
# Launch a browser for the demo with the extension's id allowlisted for tab capture, so no
# press of the shortcut is needed.
#
#   scripts/demo/chrome.sh                 Google Chrome, on a throwaway profile
#   scripts/demo/chrome.sh --chromium      Playwright's Chromium, with the extension loaded from dist
#   scripts/demo/chrome.sh [--chromium] URL...   open these instead of the demo landing page
#
# Google Chrome ignores --load-extension, so with it the extension is loaded by hand, once: on
# the first launch open chrome://extensions, turn on Developer mode, press Load unpacked and
# pick dist/extension. The profile in .build-chrome/profile remembers it.
#
# Every Google Chrome on a Mac reads the policies its MDM writes for com.google.Chrome, so on a
# managed Mac that blocks extensions, --chromium is the way: Playwright's Chromium is a Chrome
# for Testing build that takes --load-extension from the command line and did not read a policy
# written to com.google.Chrome when measured on 2026-09-10. ./provision.sh installs it.
#
# The demo itself needs `./build.sh` and `node scripts/demo/serve.mjs` running first; delete
# .build-chrome to start clean.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# shellcheck source=scripts/lib/output.sh
source scripts/lib/output.sh

EXTENSION="$PWD/dist/extension"
install_traps "scripts/demo/chrome.sh"
[ -f "$EXTENSION/manifest.json" ] || { print_error "dist/extension is missing; run ./build.sh first"; exit 1; }

mode=chrome
if [ "${1:-}" = "--chromium" ]; then
    mode=chromium
    shift
fi

# Chrome derives the id from the public key in the manifest: the first 16 bytes of the key's
# SHA-256, each nibble written as a letter from a to p.
extension_id=$(jq -r .key "$EXTENSION/manifest.json" | base64 -d | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p')

urls=("$@")
[ ${#urls[@]} -gt 0 ] || urls=("http://localhost:5173/")
args=(--no-first-run --no-default-browser-check "--allowlisted-extension-id=$extension_id")

if [ "$mode" = chromium ]; then
    [ -d node_modules ] || { print_error "node_modules is missing; run ./provision.sh"; exit 1; }
    browser=$(node -e "console.log(require('@playwright/test').chromium.executablePath())")
    [ -x "$browser" ] || { print_error "Playwright's Chromium is not installed; run ./provision.sh"; exit 1; }
    profile="$PWD/.build-chrome/chromium-profile"
    args+=("--load-extension=$EXTENSION" "--disable-extensions-except=$EXTENSION")
else
    browser="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    [ -x "$browser" ] || { print_error "Google Chrome is not at $browser"; exit 1; }
    profile="$PWD/.build-chrome/profile"
    if [ ! -f "$profile/Default/Preferences" ]; then
        urls=("chrome://extensions" "${urls[@]}")
        print_warning "fresh profile: load dist/extension unpacked from chrome://extensions once"
    fi
fi
mkdir -p "$profile"

print_success "launching $mode on $profile"
print_info "allowlisted extension id $extension_id"
print_info "${urls[*]}"
"$browser" --user-data-dir="$profile" "${args[@]}" "${urls[@]}" >/dev/null 2>&1 &
disown
result "$mode launched"
