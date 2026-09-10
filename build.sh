#!/usr/bin/env bash
#
# Build, test and check Nimbus Tab DVR.
#
#   ./build.sh              build (the default)
#   ./build.sh test         run the test suite
#   ./build.sh check        the gate CI runs: prek over every file
#   ./build.sh fmt          format every file the formatters own
#   ./build.sh clean        remove build products
#
# The project has no language yet, so build, test and fmt are declared here and do nothing.
# Each one is a single function below with a TODO naming what it will run; filling one in is
# the whole change, and `check` already enforces the repository's own rules.
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

do_build() {
    print_header "Building $NAME"
    stage "building"
    # TODO: the compiler or bundler goes here, writing into $BUILD_DIR.
    declared_only "build"
    result "nothing to build yet"
}

do_test() {
    print_header "Testing $NAME"
    stage "running the tests"
    # TODO: the test runner goes here.
    declared_only "test"
    result "no tests yet"
}

do_fmt() {
    print_header "Formatting"
    stage "formatting"
    # TODO: the language formatter goes here. Markdown reflow belongs here too, once
    # scripts/check-one-sentence-per-line.sh grows a --fix.
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
    result "checks passed"
}

do_clean() {
    print_header "Cleaning build products"
    stage "removing $BUILD_DIR"

    if [ -d "$BUILD_DIR" ]; then
        rm -rf "${BUILD_DIR:?}"
        print_success "removed $BUILD_DIR"
    else
        print_info "$BUILD_DIR does not exist"
    fi
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
