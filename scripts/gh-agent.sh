#!/usr/bin/env bash
#
# Run `gh` as the agent account rather than as Niels.
#
# Niels reviews on GitHub as himself, and an agent answers on the same pull request. Posting
# both through one token makes a review read as one person talking to themselves, and it costs
# more than clarity: GitHub refuses Approve and Request changes on your own pull request, so a
# self-opened one can only ever be COMMENTED. Opening it as the agent gives the reviewer both
# verbs back.
#
# `gh` holds several accounts at once. `gh auth token --user` reads one without making it
# active, so the account Niels types as never changes underneath him. Setting GH_TOKEN takes
# precedence over the stored credential for this call alone. Never use `gh auth switch` for
# this: it flips the active account for every later command, including his own.
#
# A `pr create` also requests a review from Niels, since every pull request an agent opens is
# one he has to review, and a request left to be remembered is one that gets forgotten. Pass
# `--reviewer` yourself to ask someone else.
#
# Usage: scripts/gh-agent.sh <any gh command>
#   scripts/gh-agent.sh pr create --title ... --body-file ...
#   scripts/gh-agent.sh pr comment 12 --body "..."
#
# Extensions work too, because this only sets GH_TOKEN for one call.
#
# Override the accounts with AGENT_GH_USER and REVIEW_GH_USER; an empty REVIEW_GH_USER
# requests no review. See CLAUDE.md, "Landing work: branches and pull requests".
#
set -euo pipefail

# shellcheck source=scripts/lib/output.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/output.sh"

AGENT_GH_USER="${AGENT_GH_USER:-njoubert-agents}"
REVIEW_GH_USER="${REVIEW_GH_USER-njoubert}"

# GitHub refuses a review request from a pull request's own author, so this asks only where the
# agent account is the one opening it, and the fallback below, which opens as Niels, adds
# nothing. Web mode is left alone as well, since the browser form carries its own picker.
wants_reviewer() {
    [ "${1:-}" = "pr" ] && [ "${2:-}" = "create" ] || return 1
    [ -n "$REVIEW_GH_USER" ] && [ "$REVIEW_GH_USER" != "$AGENT_GH_USER" ] || return 1

    local arg
    for arg in "$@"; do
        case "$arg" in
            -r | -r?* | --reviewer | --reviewer=* | --web) return 1 ;;
        esac
    done
}

if ! command_exists gh; then
    print_error "gh is not installed; run ./provision.sh"
    exit 1
fi

token="$(gh auth token --user "$AGENT_GH_USER" 2>/dev/null || true)"

# Falling back keeps a fresh clone working, but it silently reintroduces exactly the confusion
# this script exists to remove, so it says so loudly.
if [ -z "$token" ]; then
    print_warning "gh has no account '$AGENT_GH_USER': posting as the active account"
    print_info "whatever this writes will look like Niels wrote it" >&2
    print_info "fix it by logging that account in: gh auth login" >&2
    exec gh "$@"
fi

export GH_TOKEN="$token"

if wants_reviewer "$@"; then
    print_info "requesting a review from $REVIEW_GH_USER" >&2
    set -- "$@" --reviewer "$REVIEW_GH_USER"
fi

exec gh "$@"
