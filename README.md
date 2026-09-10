<h1 align="center">Nimbus Tab DVR</h1>

<p align="center">
  A digital video recorder for a browser tab.
</p>

<p align="center">
  A Manifest V3 Chrome extension that records the tab a host web application asks it to, with a demo application standing in for the host.
  The capture feasibility spike is done and <a href="docs/reports/2026-09-09-2343-capture-feasibility-spike.md">reported</a>, and the demo is built: every chunk lands on a demo backend as it is encoded, the backend remuxes the recording with ffmpeg, and the demo application plays it back seekable.
  The application contract waits behind the demo, and the client deploys through Jamf to managed Chrome.
</p>

```
./provision.sh            # a development Mac: the toolchain, npm, the git hooks, both GitHub logins
./build.sh                # Vite builds the extension and the demo into dist/
./build.sh test           # Playwright drives the extension in a real Chromium and prints its findings
./build.sh check          # the gate CI runs: prek over every file, then tsc
./build.sh clean          # remove build products
node scripts/demo/serve.mjs   # the demo backend: the demo on 5173 with the recordings API, the packed extension on 8765
scripts/demo/chrome.sh        # a real Chrome on a throwaway profile, with the extension's id allowlisted for capture; --chromium for a managed Mac
```

Work reaches `main` through a pull request, which prek enforces at commit and push time.
An agent opens and answers it as `njoubert-agents` through `scripts/gh-agent.sh`, so a review carries Approve and Request changes rather than only Comment.
See [CLAUDE.md, "Landing work"](CLAUDE.md#landing-work-branches-and-pull-requests).

`./build.sh` with an unknown command prints its own help, which is the header of the file itself.

## How it works

![How a recording moves: the page asks through the content script, the service worker gets a stream id from Chrome and hands it to the offscreen document, which encodes, spools every chunk to IndexedDB and uploads it in order to the demo backend, which remuxes with ffmpeg into a file the landing page plays](docs/how-it-works.svg)

The page never holds a channel to the extension: it posts a message on its own window, the content script relays it, and the service worker validates the origin and the message before anything happens.
Capture is granted per tab, by one press of Cmd+Shift+Y or by the allowlist flag at launch; the offscreen document owns the stream, the encoder and the spool, and every chunk is durable locally before it is uploaded.

## What is here

| Path | What it is |
| ---- | ---------- |
| [`build.sh`](build.sh) | Build, test, format, check, clean |
| [`provision.sh`](provision.sh) | Everything a fresh machine needs, re-runnable |
| [`src/extension/`](src/extension/) | The extension: service worker, content script, offscreen recorder, IndexedDB spool, console page |
| [`src/demo/`](src/demo/) | The demo host: a landing page that lists and plays the backend's recordings, then a page with a canvas, a YouTube embed and a Done button |
| [`scripts/demo/`](scripts/demo/) | The demo backend and the Chrome launcher |
| [`tests/`](tests/) | The spike and the demo as Playwright tests |
| [`scripts/`](scripts/) | The checks, the two-account GitHub wrappers, the spike's packing and policy tools, and the shared output helpers |
| [`docs/`](docs/) | The writing style, the design questions, the system diagram, [the FAQ](docs/FAQ.md), and the plans, reports and research |
| [`CLAUDE.md`](CLAUDE.md) | How to work in this repository |

## Running the demo

1. `./build.sh`, then `node scripts/demo/serve.mjs` in a terminal that stays open.
2. `scripts/demo/chrome.sh` launches Google Chrome on a throwaway profile with the extension's id allowlisted for tab capture.
   The branded Chrome ignores `--load-extension`, so on the first launch it opens `chrome://extensions`: turn on Developer mode, press Load unpacked and pick `dist/extension`, once; the profile remembers it.
3. On the landing page press Start.
   The recording page records itself; a second tab on the landing page shows the chunks landing; a reload of the recording page rejoins its recording; closing the tab still lands it; Done finalizes it, and Play scrubs it.

On a managed Mac whose Chrome policy blocks extensions, `scripts/demo/chrome.sh --chromium` runs the demo in Playwright's Chromium instead, which takes the extension from the command line and reads no Google Chrome policy; every Google Chrome channel or copy on that Mac would read the same policies and inherit the block.
The demo backend keeps its recordings in `.build-demo/recordings/` and needs `ffmpeg` on the path, which `./provision.sh` installs.
A fleet's Chrome is not launched with the flag; there, one press of Cmd+Shift+Y on the tab is what allows capture, and the recording page says so when it is needed.

## What is not here yet

**No retries, no authorization, no application contract beyond what the demo speaks, no formatter.**
The backend in this repository stands in for the client's; a backend that is down leaves the recording in IndexedDB, where the console page can still assemble it.
[docs/FAQ.md](docs/FAQ.md) answers the questions a reader asks after the demo, [docs/GRILLING.md](docs/GRILLING.md) holds the design questions with their answers so far, and [docs/plans/](docs/plans/) holds what is built next.

## Licence

MIT.
See [LICENSE](LICENSE).
