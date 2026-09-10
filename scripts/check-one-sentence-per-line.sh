#!/usr/bin/env bash
#
# Check that committed markdown holds one sentence per line, the rule in docs/WRITING_STYLE.md.
#
#   scripts/check-one-sentence-per-line.sh              every markdown file in the checkout
#   scripts/check-one-sentence-per-line.sh docs/a.md    only the files named
#
# prek runs it over the markdown a commit touches, and `./build.sh check` over every file.
# It reports and never rewrites; breaking a line is the author's edit to read.
#
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Markdown this convention does not govern: everything under .github/ is a template GitHub
# renders rather than prose anyone reviews.
governed() {
    case "$1" in
        .github/*) return 1 ;;
        *.md) [ -f "$1" ] ;;
        *) return 1 ;;
    esac
}

files=()
if [ $# -gt 0 ]; then
    for f in "$@"; do
        if governed "$f"; then files+=("$f"); fi
    done
else
    # Both tracked and merely written: a document nobody has staged yet is the one most
    # likely to need reflowing. --exclude-standard keeps the ignored trees out.
    while IFS= read -r f; do
        if governed "$f"; then files+=("$f"); fi
    done < <(git ls-files --cached --others --exclude-standard -- '*.md')
fi

if [ ${#files[@]} -eq 0 ]; then
    exit 0
fi

exec awk -f scripts/lib/one-sentence-per-line.awk "${files[@]}"
