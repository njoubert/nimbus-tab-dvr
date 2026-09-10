#!/usr/bin/env bash
#
# Set, show or remove the Chrome policies that force-install and configure the extension on
# this Mac, at user level, through Chrome's own preference domain.
#
#   scripts/spike/policy.sh install    force-install from http://localhost:8765 and set allowedOrigins
#   scripts/spike/policy.sh show       print what Chrome will read
#   scripts/spike/policy.sh remove     delete both again
#
# Chrome reads these at launch, so quit and relaunch it after install or remove, and check
# chrome://policy for what it accepted. scripts/demo/chrome.sh launches a Chrome that uses
# a separate profile but the same policies.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# shellcheck source=scripts/lib/output.sh
source scripts/lib/output.sh

KEY=.signing/nimbus-tab-dvr.pem
UPDATE_URL="${UPDATE_URL:-http://localhost:8765}"
DEMO_ORIGIN="${DEMO_ORIGIN:-http://localhost:5173}"

extension_id() {
    openssl rsa -in "$KEY" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 -binary | head -c 16 | xxd -p | tr '0-9a-f' 'a-p'
}

cmd="${1:-show}"
install_traps "scripts/spike/policy.sh $cmd"

case "$cmd" in
    install)
        print_header "Installing the Chrome policies"
        stage "writing com.google.Chrome"
        id=$(extension_id)
        defaults write com.google.Chrome ExtensionInstallForcelist -array "$id;$UPDATE_URL/updates.xml"
        print_success "ExtensionInstallForcelist: $id from $UPDATE_URL/updates.xml"
        stage "writing the managed configuration"
        defaults write "com.google.Chrome.extensions.$id" allowedOrigins -array "$DEMO_ORIGIN"
        print_success "com.google.Chrome.extensions.$id allowedOrigins: $DEMO_ORIGIN"
        print_info "relaunch Chrome, then open chrome://policy and chrome://extensions"
        result "policies written for $id"
        ;;
    show)
        print_header "Chrome policies on this Mac"
        id=$(extension_id)
        print_info "extension id: $id"
        if defaults read com.google.Chrome ExtensionInstallForcelist >/dev/null 2>&1; then
            print_success "ExtensionInstallForcelist: $(defaults read com.google.Chrome ExtensionInstallForcelist | tr -d '\n' | tr -s ' ')"
        else
            print_warning "ExtensionInstallForcelist is not set"
        fi
        if defaults read "com.google.Chrome.extensions.$id" >/dev/null 2>&1; then
            print_success "managed configuration: $(defaults read "com.google.Chrome.extensions.$id" | tr -d '\n' | tr -s ' ')"
        else
            print_warning "no managed configuration for $id"
        fi
        result "shown"
        ;;
    remove)
        print_header "Removing the Chrome policies"
        stage "deleting the keys"
        id=$(extension_id)
        defaults delete com.google.Chrome ExtensionInstallForcelist 2>/dev/null || print_info "ExtensionInstallForcelist was not set"
        defaults delete "com.google.Chrome.extensions.$id" 2>/dev/null || print_info "no managed configuration was set"
        print_success "removed; relaunch Chrome to drop the extension"
        result "policies removed"
        ;;
    *)
        print_usage_from_header "$0" >&2
        exit 2
        ;;
esac
