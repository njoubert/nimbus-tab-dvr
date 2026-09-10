# Gesture ladder: a real keystroke is the invocation, and the grant survives a reload (2026-09-10 00:05)

Page: https://claude.ai/code/artifact/646b302a-a64a-437b-ad01-d1b178b19def
Follows: [2026-09-09-2343-capture-feasibility-spike.md](2026-09-09-2343-capture-feasibility-spike.md), which left the click path unmeasured.

## Summary

With Accessibility granted to iTerm2, the spike test's gesture ladder ran with the allowlist flag off, and the second rung worked: one Cmd+Shift+Y sent as a real macOS keystroke through System Events invoked the extension on the tab, and after it three start and stop cycles, a page reload, a killed offscreen document and an audio capture all ran with no further gesture.
The probe after the reloaded page stopped its recording was granted without another keystroke, so a grant earned by invocation survives a same-origin reload.
This is the deployment path: the fleet's Chrome is not launched with the flag, so a recording needs one invocation per tab, and that invocation is now shown to be one keystroke or click that the rest of the tab's life inherits.
Playwright's own keyboard still does not count, as the spike report expected, since it reaches the renderer and not the browser's accelerator table.

## The run

Niels ran `NIMBUS_ALLOWLIST=0 ./build.sh test` on 2026-09-10 after granting iTerm2 Accessibility in System Settings, Privacy and Security.
The findings the test printed, in order:

```text
Chromium 153.0.8010.12 (Playwright channel "chromium", headless=false, allowlisted=false)
probe on a fresh tab with no invocation: refused (Extension has not been invoked for the current page (see activeTab permission). Chrome pages cannot be captured.)
START_RECORDING with no invocation: RECORDING_ERROR CAPTURE_FAILED, same detail
Playwright keyboard shortcut: pressed Meta+Shift+KeyY through Playwright; probe after it: refused
System Events keystroke: sent: Cmd+Shift+Y via System Events; probe after it: GRANTED (Chrome issued a stream id)
invocation that worked: System Events keystroke
cycle 1: RECORDING_STARTED 1920x1080 at 15 fps vp9; RECORDING_STOPPED chunks 4, bytes 1,294,953; cycle-1.webm 94 packets, last video packet at 6.25 s
cycle 2: RECORDING_STARTED; RECORDING_STOPPED chunks 2, bytes 1,499,575
cycle 3: RECORDING_STARTED; RECORDING_STOPPED chunks 2, bytes 1,468,646
START_RECORDING sent again by the reloaded page: RECORDING_ERROR ALREADY_RECORDING, naming the live recording
probe while the reloaded page's recording is live: refused (Cannot capture a tab with an active stream.)
stop from the reloaded page: RECORDING_STOPPED chunks 1, bytes 941,703
probe after the reload, once the stream is released: GRANTED (Chrome issued a stream id)
stop after the offscreen document was killed: RECORDING_ERROR OFFSCREEN_GONE; killed.webm 78 packets, last video packet at 4.95 s
start with audio: RECORDING_STARTED audio true; audio.webm streams vp9 and opus, 201 packets, last video packet at 6.13 s
2 passed (51.3s)
```

The third rung, a System Events click on the toolbar button, never ran, because the ladder stops at the first rung Chrome accepts.

## What it decides

- **One invocation per tab is a keystroke or a click, once.**
  The `commands` shortcut in the manifest, Cmd+Shift+Y on macOS, is enough, and the application can tell the user exactly that on its landing page.
- **The grant outlives a reload.**
  The Chrome documentation says a same-origin navigation keeps it and is silent on reload; this run says reload keeps it too.
- **The test now covers both paths.**
  `./build.sh test` runs with the flag, which CI can do headless; `NIMBUS_ALLOWLIST=0 ./build.sh test` runs the keystroke on a Mac whose terminal has Accessibility.

## Verified and unverified

- **Verified by running:** everything in the run above, on Playwright's Chromium 153.0.8010.12, headed.
- **Not measured:** the toolbar click, which was never reached; the same on Google Chrome 150, which the spike report explains cannot load the extension unpacked; whether a grant survives a cross-origin navigation, which the documentation says it does not.

## Provenance

- `main` at the merge of #3, `ea6cd35`; the test is `tests/spike.spec.ts` as merged.
- Run by Niels in iTerm2 with Accessibility granted; the output above is his terminal's, trimmed to the findings.
