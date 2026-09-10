#!/usr/bin/env bash
#
# Read a pull request's review back out of GitHub so the work can continue
# locally, and write replies back when it is addressed.
#
# `gh pr view --comments` shows only the conversation timeline, so it misses
# every inline comment anchored to a file and line, which is where a code review
# actually happens. This script reads all three layers in one GraphQL call:
# inline review threads (with their resolution state), the summary body typed
# when a review was submitted, and the timeline comments.
#
# Usage:
#   scripts/pr-review.sh fetch [PR]        unresolved threads and reviews (default)
#   scripts/pr-review.sh fetch --all [PR]  include already-resolved threads
#   scripts/pr-review.sh reply THREAD_ID BODY
#
# PR defaults to the pull request for the checked-out branch.
#
# See CLAUDE.md, "Landing work: branches and pull requests".

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Reads are anonymous in effect, so they run as whichever account is active.
# Writes carry an author, so they go through the agent account: a reply that
# arrives under Niels's name makes the review read as one person talking to
# themselves. See scripts/gh-agent.sh.
GH_AGENT="$SCRIPT_DIR/gh-agent.sh"

die() {
    echo "✗ $*" >&2
    exit 1
}

command -v gh >/dev/null 2>&1 || die "gh is not installed; run ./provision.sh"
command -v jq >/dev/null 2>&1 || die "jq is not installed; run ./provision.sh"

gh auth status >/dev/null 2>&1 || die "gh is not authenticated; run: gh auth login"

resolve_pr_number() {
    if [ -n "${1:-}" ]; then
        echo "$1"
        return
    fi
    gh pr view --json number --jq .number 2>/dev/null ||
        die "No pull request for the checked-out branch. Pass a PR number."
}

# GraphQL and jq programs below use $variables of their own; the shell must
# leave them alone, so every one of these is deliberately single-quoted.
# shellcheck disable=SC2016
GRAPHQL_QUERY='
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      title
      url
      headRefName
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          originalLine
          comments(first:50) {
            nodes { author { login } body diffHunk }
          }
        }
      }
      reviews(first:50) {
        nodes { author { login } state body submittedAt }
      }
      comments(first:50) {
        nodes { author { login } body createdAt }
      }
    }
  }
}'

# Renders the GraphQL payload as markdown an agent can work through top to
# bottom. Thread ids are printed because reply needs them.
# shellcheck disable=SC2016
JQ_RENDER='
def trimhunk: (split("\n") | if length > 8 then .[-8:] else . end | join("\n"));
.data.repository.pullRequest as $pr
| "# Review of PR: \($pr.title)\n\($pr.url)\nbranch: \($pr.headRefName)\n",
  (
    [ $pr.reviewThreads.nodes[] | select($showall or (.isResolved | not)) ] as $threads
    | if ($threads | length) == 0 then "\n## Inline threads\n\nNone outstanding.\n"
      else "\n## Inline threads (\($threads | length))\n",
        ( $threads | to_entries[] |
          .value as $t |
          "\n### [\(.key + 1)] \($t.path):\($t.line // $t.originalLine // 0)"
          + (if $t.isResolved then "  [RESOLVED]" else "" end)
          + (if $t.isOutdated then "  [OUTDATED]" else "" end)
          + "\nthread: \($t.id)\n"
          + "\n```diff\n\($t.comments.nodes[0].diffHunk // "" | trimhunk)\n```\n"
          + ( [ $t.comments.nodes[] | "\n**@\(.author.login // "unknown")**: \(.body)" ] | join("\n") )
          + "\n"
        )
      end
  ),
  (
    [ $pr.reviews.nodes[] | select((.body // "") != "") ] as $reviews
    | if ($reviews | length) == 0 then empty
      else "\n## Review summaries\n",
        ( $reviews[] | "\n### @\(.author.login // "unknown"), \(.state)\n\n\(.body)\n" )
      end
  ),
  (
    [ $pr.comments.nodes[] | select((.body // "") != "") ] as $comments
    | if ($comments | length) == 0 then empty
      else "\n## Conversation\n",
        ( $comments[] | "\n### @\(.author.login // "unknown")\n\n\(.body)\n" )
      end
  )'

cmd_fetch() {
    local showall=false
    if [ "${1:-}" = "--all" ]; then
        showall=true
        shift
    fi

    local pr owner repo
    pr="$(resolve_pr_number "${1:-}")"
    owner="$(gh repo view --json owner --jq .owner.login)"
    repo="$(gh repo view --json name --jq .name)"

    gh api graphql \
        -F owner="$owner" -F repo="$repo" -F pr="$pr" \
        -f query="$GRAPHQL_QUERY" |
        jq -r --argjson showall "$showall" "$JQ_RENDER"
}

cmd_reply() {
    local thread="${1:?usage: pr-review.sh reply THREAD_ID BODY}"
    local body="${2:?usage: pr-review.sh reply THREAD_ID BODY}"

    # shellcheck disable=SC2016
    "$GH_AGENT" api graphql -F thread="$thread" -F body="$body" -f query='
      mutation($thread:ID!, $body:String!) {
        addPullRequestReviewThreadReply(
          input:{pullRequestReviewThreadId:$thread, body:$body}
        ) { comment { url } }
      }' --jq .data.addPullRequestReviewThreadReply.comment.url
}

case "${1:-fetch}" in
    fetch)
        shift || true
        cmd_fetch "$@"
        ;;
    reply)
        shift
        cmd_reply "$@"
        ;;
    *)
        die "usage: $(basename "$0") [fetch [--all] [PR] | reply THREAD_ID BODY]"
        ;;
esac
