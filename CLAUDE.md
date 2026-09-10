# Nimbus Tab DVR: notes for agents

A digital video recorder for a browser tab, and at present a skeleton: the repository has its scripts, its checks and its conventions, and no language.
[README.md](README.md) is the user-facing description; read it first and keep it true when behaviour changes.
This file is the rest: how to work here, and what has already been decided.

A sibling of `../nimbus-net-bar`, `../nimbus-leviton-bar`, `../nimbus-dmx-helper` and `../nimbus-updater`, which share these conventions and whose own CLAUDE.md files carry the traps each one has found.

## Your rhetorical style

State the substantive point directly.
Do not announce or characterize what follows, and do not tell the reader that something is important, interesting, or worth noting; explain it.

## Writing style

**Everything written here follows [docs/WRITING_STYLE.md](docs/WRITING_STYLE.md): terse and formal, one sentence per line in committed markdown, no em or en dashes.**
The prek hook enforces the line rule; the rest is on you.

## Ground rules

- **Grill me relentlessly.** Before building a feature, ask every question whose answer would change the work, with the facts already checked, and prefer `AskUserQuestion` for crisp either-or calls.
- **Be concise.** Short reports, no repetition, the salient facts only.
- **Decisions, not options.** Surface the alternatives you rejected in one line each, then recommend.
- **`prek` must pass.** `./provision.sh` installs the hooks; `./build.sh check` runs them over every file, and it must pass before you claim done.
- **Never disable a hook to get past it.** Shellcheck runs at its default severity, so `A && B || true` is flagged; write an `if`.
- **Documentation tasks are documentation-only.** When the task is to record something, the deliverable is the document; offer the implementation as a next step and wait.
- **The unanswered questions in [docs/GRILLING.md](docs/GRILLING.md) are unanswered.** Do not build past one; ask it.

## Working style: single developer project

- **Minimum work.** Do only what the task needs.
- **Refactor the system rather than layering on top of it.** Changing an interface is cheap in a single-developer repository; carrying two ways to do one thing is not.
- **Support standard commands, do not wrap them.** A script helps after `git commit`; it does not replace it.
- **Every script reads its own `# Usage:` header for help**, so the help and the file cannot disagree.
- **There is no Makefile.** The targets would be wrappers with no dependency graph, and the sibling repositories on this machine use scripts.

## Coding principles

1. **Conventional commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `chore:`) with an imperative subject under 72 characters, in the house style.
2. **No process trail in code.** A comment explains what the code does and why; ticket numbers, dates and conversation history live in `docs/` and in git.
3. **Let naming carry the meaning.** Keep comments few; a field in a struct should not need one.
4. **A licence header on every new source file**, carrying `Copyright (C) 2026 Niels Joubert` and `SPDX-License-Identifier: MIT`.
   The project is MIT, the permissive end of the nimbus family, so do not vendor code under a licence that would force the whole thing to be something else.
5. **Comments explain the trap, not the syntax.** The comment worth writing is the one that says why the obvious version was wrong.

## Layout

```text
build.sh                  build | test | fmt | check | clean; `./build.sh nonsense` prints help
provision.sh              a development Mac: the toolchain and the git hooks
scripts/
  gh-agent.sh                      runs `gh` as njoubert-agents, for anything that writes
  pr-review.sh                     fetch a review's inline threads, and reply into one
  check-protected-branch.sh        the main guard, wired into prek at commit and push
  check-one-sentence-per-line.sh   the markdown line rule, wired into prek
  lib/output.sh                    the shared print_* helpers every script sources
  lib/one-sentence-per-line.awk    the check itself, in awk so it needs no toolchain
docs/
  WRITING_STYLE.md        binds everything written here
  GRILLING.md             the design questions and their answers
  plans/                  what will be built, agreed before it is built
  reports/                what happened, dated and never updated
  research/               what was established from primary sources, maintained
.github/
  workflows/ci.yml        the same checks CI runs
  pull_request_template.md  the sections every pull request fills in
```

## Project scripts

| Script | What it does |
| ------ | ------------ |
| `./provision.sh` | Installs the Homebrew tools, the git hooks, and both GitHub logins |
| `./provision.sh check` | Reports what is installed and what is missing, and exits nonzero on a gap |
| `scripts/gh-agent.sh <gh args>` | Runs `gh` as `njoubert-agents` for one call, without switching the active account |
| `scripts/pr-review.sh fetch [PR]` | The inline review threads `gh pr view --comments` does not show |
| `scripts/pr-review.sh reply THREAD_ID BODY` | Answers one thread, as the agent account |
| `./build.sh` | Builds |
| `./build.sh test` | Runs the test suite |
| `./build.sh check` | The gate CI runs: `prek run --all-files` |
| `./build.sh fmt` | Formats every file the formatters own |
| `./build.sh clean` | Removes build products |

**`build` , `test` and `fmt` are declared and do nothing**, because the language is not chosen.
Each is one function in `build.sh` with a TODO naming what it will run, and filling one in is the whole change.

**Script output follows `../weshootfilm/provision.sh`**, so every script on this machine reads the same.
`print_header` opens a section, `print_success` (✓), `print_warning` (⚠), `print_error` (✗) and `print_info` carry the lines, and the EXIT trap prints a closing banner so no run can end on an ambiguous note.
The headline carries the glyph and detail lines sit indented under it; warnings and errors go to stderr so a failure survives a pipe.
An ERR trap names the failing stage, so call `stage "..."` before anything long and `result "..."` to say what the green banner reports.
All of it lives in [scripts/lib/output.sh](scripts/lib/output.sh); a new script sources that rather than copying it.

## Where plans, research and reports live

**Three directories, three lifetimes**, each with a README holding its own convention.

- **[docs/plans/](docs/plans/README.md)** is what will be built, rewritten while it is argued about and frozen when the work starts.
- **[docs/reports/](docs/reports/README.md)** is what happened, named `YYYY-MM-DD-HHMM-slug.md`, never edited afterwards, and paired with an HTML page published as an artifact.
- **[docs/research/](docs/research/README.md)** is what primary sources say, maintained in place, and every note ends with what it verified and what it did not.

Read the README of a directory before writing into it rather than copying the shape of the file beside yours.

## Landing work: branches and pull requests

**`main` is protected, and work reaches it through a pull request Niels reviews.**
He reviews on GitHub in the browser; the work happens locally.
Reviewing his own agents' code is the point of this flow, so routing around it defeats the purpose rather than saving time.

- **Never commit, never create a branch, and never judge whether a change is too large or too small for a pull request.**
  All three are Niels's calls, and there is deliberately no size or change-type threshold for an agent to apply.
- **Make the edits, report what changed, and stop there.**
  He then says "just land it", or asks for a pull request, or takes it from there himself.
- **Ask when you do not know which he wants**, because asking costs one sentence and guessing costs a branch, a pull request, and a review he did not want to do.
- **A branch he has already asked for is the standing exception**, where a direct request authorizes committing and pushing to that branch, and to that branch only.
- **When he does ask for a pull request, branch first with plain git**, since `main` is protected: `git switch -c feat/short-description`, commit, then `git push -u origin <branch>`.
  One branch is one pull request.
- **Never commit while `main` is checked out, and never push to `main`.**
- **[scripts/check-protected-branch.sh](scripts/check-protected-branch.sh) enforces this** from prek at the pre-commit and pre-push stages.
  Treat a rejected commit as the answer, not as an obstacle to work around.
- **The guard is a redirect, not a seal**, and `--no-verify` defeats it.
- **`ALLOW_MAIN=1` is the named exception, and it belongs to Niels rather than to an agent.**

**An agent posts as `njoubert-agents`, never as Niels.**
Push with your own credential, so commits stay authored by him, but route every `gh` call that **writes** something a reader will attribute to a person through **[scripts/gh-agent.sh](scripts/gh-agent.sh)**: `pr create`, `pr comment`, `pr edit`, and the replies `scripts/pr-review.sh` sends.
This is not cosmetic.
GitHub refuses Approve and Request changes on your own pull request, so one Niels opens can only ever be `COMMENTED`, and he loses the two verbs a review is made of.
**Never run `gh auth switch`**, which changes the active account for everything he types afterwards; the wrapper reads the agent token without disturbing it.

**Opening the pull request.**
Push the branch, then `scripts/gh-agent.sh pr create`.
Pull requests land as merge commits, so every commit on the branch reaches `main` and each one takes a conventional-commit subject under 72 characters in the house style, not only the last.
The pull-request title becomes the merge commit subject, so it says what the branch did as a whole.

**Every pull request an agent opens requests a review from Niels**, so it reaches him as a request rather than as a page he has to remember to visit.
The wrapper appends `--reviewer njoubert` to `pr create` itself, so pass the flag only to name someone else.
Override the handle with `REVIEW_GH_USER`, and set it empty to request nothing.

**Open it once it exists**, with `gh pr view <PR> --web`, so the review is waiting in the browser rather than a URL he has to copy.
Run that as a plain `gh` call rather than through the agent wrapper, since opening a browser is a read and belongs on his session.

**Fill [.github/pull_request_template.md](.github/pull_request_template.md), and never pass `--fill`**, which replaces the template with commit messages and so drops the design-decisions section entirely.
`gh` populates the template only in interactive and `--web` runs, so an agent reads that file itself and passes the completed text as `--body-file`.
**Design decisions is the section that matters**: it records the choices raised under "Grill me relentlessly" above, each one naming what it was chosen over and what it costs.
**Write each paragraph of the body as one unwrapped line**, since GitHub renders a newline there as a line break, and draw the shape in a mermaid fence rather than in ASCII art.

**Reading a review back.**
Use `scripts/pr-review.sh fetch`, never `gh pr view --comments`, which shows only the timeline and silently omits every comment anchored to a file and line.
Reply where the comment was left, with `scripts/pr-review.sh reply THREAD_ID BODY`, which posts as the agent account.

## What is not decided yet

**The language, the runtime, the capture interface and the distribution channel are all open**, and [docs/GRILLING.md](docs/GRILLING.md) holds the questions in the order their answers matter.
When one is settled, the answer goes in that file, the affected script grows its real implementation, and this section shrinks.
