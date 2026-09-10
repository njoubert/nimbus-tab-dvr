#!/usr/bin/env bash
#
# Keep work off the protected branch, so every change reaches main through a reviewed pull
# request. The guard runs at two moments, because one alone is not enough: at commit time it
# rejects a commit made while main is checked out, and at push time it rejects a push whose
# target ref is main.
#
# Wired from .pre-commit-config.yaml as `no-commit-to-main` (pre-commit stage) and
# `no-push-to-main` (pre-push stage). The push half is the only hook on that stage, so a push
# costs this check and nothing else.
#
# ALLOW_MAIN=1 is the deliberate exception, and it is meant to be usable: a typo fix does not
# need a pull request. Prefer it over --no-verify, which also disables the secret detector.
#
# The guard redirects work onto branches; it does not seal main, and nothing here tries to.
# Deliberate exceptions are the developer's to make.
#
# One narrow gap: prek skips the pre-push stage entirely when the ref being pushed does not yet
# exist on the remote and carries no commits the remote lacks, so no hook runs at all. That
# cannot reach a main which is already published, and fast-forwarding an existing main onto an
# already-pushed branch and pushing it does fire this guard.
#
# See CLAUDE.md, "Landing work: branches and pull requests".
#
set -euo pipefail

PROTECTED="${PROTECTED_BRANCH:-main}"
MODE="${1:-commit}"

if [ "${ALLOW_MAIN:-}" = "1" ]; then
    echo "⚠ ALLOW_MAIN=1 set: the branch guard is bypassed for this ${MODE}."
    exit 0
fi

# Empty on a detached HEAD (a rebase, a bisect, a checked-out tag), which the guard treats as
# allowed: no branch is being written to.
current_branch() {
    git symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

case "$MODE" in
    commit)
        target="$(current_branch)"
        ;;
    push)
        # prek publishes the ref being pushed to. Tag pushes arrive as refs/tags/... and so
        # never match. Fall back to the checked-out branch when the hook is invoked outside a
        # real push, as `prek run --hook-stage` does.
        target="${PRE_COMMIT_REMOTE_BRANCH:-}"
        target="${target#refs/heads/}"
        if [ -z "$target" ]; then target="$(current_branch)"; fi
        ;;
    *)
        echo "usage: $(basename "$0") [commit|push]" >&2
        exit 2
        ;;
esac

if [ "$target" != "$PROTECTED" ]; then
    exit 0
fi

echo ""
if [ "$MODE" = "commit" ]; then
    echo "✗ ${PROTECTED} is protected: commit on a branch instead."
    echo ""
    echo "   Work reaches ${PROTECTED} only through a pull request you review."
    echo "   Staged changes follow you onto a new branch:"
    echo ""
    echo "     git switch -c feat/short-description"
    echo "     git commit"
else
    echo "✗ ${PROTECTED} is protected: open a pull request instead."
    echo ""
    echo "   Push the branch and let the pull request carry it across:"
    echo ""
    echo "     git push -u origin \$(git symbolic-ref --quiet --short HEAD)"
    echo "     scripts/gh-agent.sh pr create"
fi
echo ""
echo "   Deliberate exception: ALLOW_MAIN=1 git ${MODE} ..."
echo ""
exit 1
