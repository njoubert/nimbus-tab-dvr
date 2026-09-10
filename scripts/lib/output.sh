#!/usr/bin/env bash
#
# Shared script output, sourced by ./provision.sh and ./build.sh.
#
# The style follows ../weshootfilm/provision.sh and the other nimbus repositories, so every
# script on this machine reads the same: a ruled blue header per section, then ✓ / ⚠ / ✗ lines
# with indented detail under them, and a closing banner that every run ends on.
#
#   print_header "Section"    a ruled blue section title
#   print_success "..."       ✓, the good news
#   print_warning "..."       ⚠, to stderr
#   print_error   "..."       ✗, to stderr
#   print_info    "..."       indented detail under the line above it
#   print_done / print_failed the closing banner, printed by the EXIT trap
#
# Warnings and errors go to stderr, where provision.sh puts them on stdout, so a failure
# survives a pipe.
#
# Usage, from a script that has already run `set -Eeuo pipefail` and cd'd to the repo root:
#
#   source scripts/lib/output.sh
#   install_traps "./build.sh $cmd"
#   stage "unpacking the archive"    # names the failure if the next command dies
#   result "installed 3 tools"       # what the green closing banner says
#
# shellcheck shell=bash

red=$'\033[0;31m'; green=$'\033[0;32m'; yellow=$'\033[1;33m'; blue=$'\033[0;34m'
reset=$'\033[0m'
rule="================================================="

# No colour when the output is not a terminal, so a log file or a CI transcript stays readable.
if [ ! -t 1 ]; then red=""; green=""; yellow=""; blue=""; reset=""; fi

print_header()  { printf '\n%s%s\n%s\n%s%s\n\n' "$blue" "$rule" "$*" "$rule" "$reset"; }
print_success() { printf '%s✓ %s%s\n' "$green" "$*" "$reset"; }
print_warning() { printf '%s⚠ %s%s\n' "$yellow" "$*" "$reset" >&2; }
print_error()   { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; }
print_info()    { printf '  %s\n' "$*"; }
print_done()    { printf '\n%s%s\n✓ %s\n%s%s\n\n' "$green" "$rule" "$*" "$rule" "$reset"; }
print_failed()  { printf '\n%s%s\n✗ %s\n%s%s\n\n' "$red" "$rule" "$*" "$rule" "$reset" >&2; }

command_exists() { command -v "$1" >/dev/null 2>&1; }

# What the closing banner says on success. A command sets it to something better than its name.
RESULT=""
result() { RESULT=$1; }

# What the script is doing, for the failure message. `set -e` exits with whatever the failing
# command printed, which for an archive tool or a code signer is often nothing at all, and a
# run that died half way then looks exactly like a run that finished.
STAGE=""
stage() { STAGE=$1; }

# The name of the invocation, for both banners. install_traps sets it.
INVOCATION=""

on_error() {
    local code=$1 line=$2 cmd=$3 src=$4
    print_error "FAILED: ${STAGE:-$INVOCATION}, exit $code at $src line $line"
    print_info "command: $cmd" >&2
    exit "$code"
}

# Every run ends on a banner, so no command can leave the outcome ambiguous.
on_exit() {
    local code=$?
    if [ "$code" -eq 0 ]; then
        print_done "${RESULT:-$INVOCATION}"
    elif [ "$code" -eq 2 ]; then
        : # usage was printed; a banner under it would say nothing.
    else
        print_failed "${RESULT:-$INVOCATION}, exit $code"
    fi
}

# -E in `set -Eeuo pipefail` is what makes functions and subshells inherit the ERR trap.
install_traps() {
    INVOCATION=$1
    trap 'on_error "$?" "$LINENO" "$BASH_COMMAND" "${BASH_SOURCE[0]}"' ERR
    trap 'on_exit' EXIT
    trap 'print_error "interrupted during ${STAGE:-$INVOCATION}"; exit 130' INT TERM
}

# The script's own `# Usage:` header is its help, so the two cannot disagree.
print_usage_from_header() {
    sed -n '2,/^set -/p' "$1" | grep '^#' | sed 's/^# \{0,1\}//'
}
