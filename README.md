<h1 align="center">Nimbus Tab DVR</h1>

<p align="center">
  A digital video recorder for a browser tab.
</p>

<p align="center">
  <em>Skeleton.</em> The repository holds its scripts, its checks and its conventions; the language, the capture interface and the distribution channel are not chosen yet.
</p>

```
./provision.sh            # a development Mac: the toolchain, the git hooks, both GitHub logins
./build.sh                # build
./build.sh test           # run the test suite
./build.sh check          # the gate CI runs: prek over every file
./build.sh clean          # remove build products
```

Work reaches `main` through a pull request, which prek enforces at commit and push time.
An agent opens and answers it as `njoubert-agents` through `scripts/gh-agent.sh`, so a review carries Approve and Request changes rather than only Comment.
See [CLAUDE.md, "Landing work"](CLAUDE.md#landing-work-branches-and-pull-requests).

`./build.sh` with an unknown command prints its own help, which is the header of the file itself.

## What is here

| Path | What it is |
| ---- | ---------- |
| [`build.sh`](build.sh) | Build, test, format, check, clean |
| [`provision.sh`](provision.sh) | Everything a fresh machine needs, re-runnable |
| [`scripts/`](scripts/) | The checks, the two-account GitHub wrappers, and the shared output helpers |
| [`docs/`](docs/) | The writing style, the design questions, and the plans, reports and research |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repository |

## What is not here yet

**No language, no build, no tests.**
`./build.sh build`, `test` and `fmt` are declared and print that they are not implemented, so a fresh checkout and CI both pass from the first commit.
[docs/GRILLING.md](docs/GRILLING.md) holds the open questions in the order their answers matter, and answering one is what turns a stub into a build.

## Licence

MIT.
See [LICENSE](LICENSE).
