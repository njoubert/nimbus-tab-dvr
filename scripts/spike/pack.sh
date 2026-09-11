#!/usr/bin/env bash
#
# Pack the built extension into a .crx and write the update manifest Chrome force-installs from.
#
#   scripts/spike/pack.sh          write dist/pack/nimbus-tab-dvr.crx and dist/pack/updates.xml
#
# Needs .signing/nimbus-tab-dvr.pem, the key whose public half is in the manifest; the id Chrome
# derives from it is printed. Run ./build.sh first.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# shellcheck source=scripts/lib/output.sh
source scripts/lib/output.sh

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KEY=.signing/nimbus-tab-dvr.pem
UPDATE_URL="${UPDATE_URL:-http://localhost:8765}"

install_traps "scripts/spike/pack.sh"
print_header "Packing the extension"

stage "checking the inputs"
[ -f dist/extension/manifest.json ] || { print_error "dist/extension is missing; run ./build.sh"; exit 1; }
[ -f "$KEY" ] || { print_error "$KEY is missing"; print_info "openssl genrsa -out $KEY 2048, then put its public key in the manifest"; exit 1; }
[ -x "$CHROME" ] || { print_error "Google Chrome is not at $CHROME"; exit 1; }

stage "deriving the extension id"
id=$(openssl rsa -in "$KEY" -pubout -outform DER 2>/dev/null | openssl dgst -sha256 -binary | head -c 16 | xxd -p | tr '0-9a-f' 'a-p')
version=$(jq -r .version dist/extension/manifest.json)
print_success "id $id, version $version"

stage "packing with Chrome"
rm -rf dist/pack dist/extension.crx dist/extension.pem
mkdir -p dist/pack
# Chrome writes <dir>.crx beside the directory it packs, and pops a dialog unless told not to.
"$CHROME" --pack-extension="$PWD/dist/extension" --pack-extension-key="$PWD/$KEY" --no-message-box >/dev/null 2>&1 || true
[ -f dist/extension.crx ] || { print_error "Chrome did not write dist/extension.crx"; exit 1; }
mv dist/extension.crx dist/pack/nimbus-tab-dvr.crx
print_success "dist/pack/nimbus-tab-dvr.crx ($(stat -f %z dist/pack/nimbus-tab-dvr.crx) bytes)"

stage "writing the update manifest"
cat > dist/pack/updates.xml <<EOF
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='$id'>
    <updatecheck codebase='$UPDATE_URL/nimbus-tab-dvr.crx' version='$version' />
  </app>
</gupdate>
EOF
print_success "dist/pack/updates.xml points at $UPDATE_URL/nimbus-tab-dvr.crx"
print_info "serve it with: dist/backend/nimbus-demo-backend"
print_info "force-install it with: scripts/spike/policy.sh install"
result "packed $id $version"
