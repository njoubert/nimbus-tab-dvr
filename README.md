<h1 align="center">Nimbus Tab DVR</h1>

<p align="center">
  A digital video recorder for a browser tab.
</p>

<p align="center">
  A Manifest V3 Chrome extension that records the tab a host web application asks it to, with a demo application standing in for the host.
  The capture feasibility spike is done and <a href="docs/reports/2026-09-09-2343-capture-feasibility-spike.md">reported</a>; the application contract, the upload path and the distribution channel come next.
</p>

```
./provision.sh            # a development Mac: the toolchain, npm, the git hooks, both GitHub logins
./build.sh                # Vite builds the extension and the demo into dist/
./build.sh test           # Playwright drives the extension in a real Chromium and prints its findings
./build.sh check          # the gate CI runs: prek over every file, then tsc
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
| [`src/extension/`](src/extension/) | The extension: service worker, content script, offscreen recorder, IndexedDB spool, console page |
| [`src/demo/`](src/demo/) | The demo host: a landing page, then a page with a canvas, a YouTube embed and a Done button |
| [`tests/`](tests/) | The spike as a Playwright test |
| [`scripts/`](scripts/) | The checks, the two-account GitHub wrappers, the spike's packing and policy tools, and the shared output helpers |
| [`docs/`](docs/) | The writing style, the design questions, and the plans, reports and research |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repository |

## What is not here yet

**No upload, no application contract beyond start and stop, no formatter.**
The extension records into IndexedDB and stops there; the console page assembles a file by hand.
[docs/GRILLING.md](docs/GRILLING.md) holds the questions with their answers so far, and [docs/plans/](docs/plans/) holds what is built next.

## Licence

MIT.
See [LICENSE](LICENSE).
