#!/usr/bin/env bash
#
# Build, test and check Nimbus Tab DVR.
#
#   ./build.sh              build (the default)
#   ./build.sh test         run the test suite
#   ./build.sh check        the gate CI runs: prek over every file, then tsc
#   ./build.sh fmt          format every file the formatters own
#   ./build.sh clean        remove build products
#
# The language is TypeScript: Vite builds the extension and the demo, Playwright runs the
# tests, and `check` adds tsc to the prek hooks. `fmt` is still declared and does nothing.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck source=scripts/lib/output.sh
source scripts/lib/output.sh

NAME=nimbus-tab-dvr
BUILD_DIR=dist

# Announce a step that has no implementation yet, and succeed, so a fresh checkout and CI both
# stay green while the shape of the repository is being settled.
declared_only() {
    print_warning "$1 is not implemented yet"
    print_info "declare it in build.sh, in the function above this message"
}

require_node_modules() {
    if [ ! -d node_modules ]; then
        print_error "node_modules is missing"
        print_info "run ./provision.sh, or: npm ci"
        exit 1
    fi
}

do_build() {
    print_header "Building $NAME"
    require_node_modules

    stage "bundling the extension"
    npx vite build --config vite.extension.config.ts --logLevel warn
    # A content script is a classic script. Vite emits it as a module chunk, which is fine
    # exactly as long as it shares no code with the other entries; an import here means it
    # did, and Chrome would fail to load it with no message worth reading.
    if grep -qE '^(import|export) ' "$BUILD_DIR/extension/content-script.js"; then
        print_error "content-script.js contains an import; it must stay dependency free"
        exit 1
    fi
    print_success "extension: $BUILD_DIR/extension ($(find "$BUILD_DIR/extension" -name '*.js' | wc -l | tr -d ' ') scripts)"

    stage "bundling the demo application"
    npx vite build --config vite.demo.config.ts --logLevel warn
    print_success "demo: $BUILD_DIR/demo"
    result "built into $BUILD_DIR"
}

do_test() {
    print_header "Testing $NAME"
    require_node_modules
    if [ ! -f "$BUILD_DIR/extension/manifest.json" ]; then
        print_error "$BUILD_DIR/extension is missing; run ./build.sh first"
        exit 1
    fi
    stage "running Playwright"
    npx playwright test "$@"
    print_success "tests passed"
    result "tests passed"
}

do_fmt() {
    print_header "Formatting"
    stage "formatting"
    # TODO: no formatter is in the dependency budget yet. Markdown reflow belongs here too,
    # once scripts/check-one-sentence-per-line.sh grows a --fix.
    declared_only "fmt"
    result "nothing to format yet"
}

do_check() {
    print_header "Checking $NAME"
    stage "running prek over every file"

    if ! command_exists prek; then
        print_error "prek is not installed"
        print_info "run ./provision.sh"
        exit 1
    fi

    # The branch guard answers "may this commit happen", not "are these files clean", and it
    # fires on a real commit or push. Running it here would fail every check made while main
    # is checked out, which is a lint run rather than an attempt to write to main.
    SKIP=no-commit-to-main prek run --all-files
    print_success "prek passed"

    stage "type checking"
    require_node_modules
    npx tsc --noEmit
    print_success "tsc passed"
    result "checks passed"
}

do_clean() {
    print_header "Cleaning build products"
    stage "removing $BUILD_DIR"

    local dir
    for dir in "$BUILD_DIR" test-results playwright-report; do
        if [ -d "$dir" ]; then
            rm -rf "${dir:?}"
            print_success "removed $dir"
        else
            print_info "$dir does not exist"
        fi
    done
    result "clean"
}

cmd="${1:-build}"
install_traps "./build.sh $cmd"
[ $# -gt 0 ] && shift

case "$cmd" in
    build) do_build "$@" ;;
    test)  do_test "$@" ;;
    fmt)   do_fmt "$@" ;;
    check) do_check "$@" ;;
    clean) do_clean "$@" ;;
    *)
        print_usage_from_header "$0" >&2
        exit 2
        ;;
esac
