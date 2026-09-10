# Nimbus Tab DVR: design interrogation

Questions raised against the shape of the project before research and planning.
Answer inline under each **Answer:** marker.
"Don't know" is a valid answer.

Sections are ordered by how much damage a wrong answer does.
A question that has been answered stays here with its answer, because the reason for a decision is worth more later than the decision is.

---

## 1. What it is

**1a.** What does "tab DVR" record: a browser tab's rendered video, its audio, the whole tab as a screen capture, or a stream it is playing?

**Answer:** The rendered video of one tab, composited, so a cross-origin iframe such as a YouTube embed is in the frame.
Whether the tab's audio joins it is decided by Q3 of the spike plan.
Not a screen capture and not a stream the tab is playing.

**1b.** Who is it for, and how many of them are there?

**Answer:** A client's web application, running on a managed macOS Chrome fleet whose size is not known yet.
The demo application in this repository stands in for it.
The repository is a handoff: the extension and the demo are here, the client's backend stays theirs.

**1c.** What does the user do with a recording once it exists?

**Answer:** Nothing, locally.
The extension uploads it to the client's backend, which remuxes the timesliced chunks into a seekable file.
The extension never has to produce a seekable file itself.

---

## 2. The load-bearing assumption

**2a.** Which capture interface is this built on, and does it give what the design needs on the platforms in scope?

**Answer:** `chrome.tabCapture.getMediaStreamId` from a Manifest V3 service worker, consumed by an offscreen document.
The Chrome documentation says capture needs the extension to have been invoked on that tab, and the grant survives same-origin navigation.
One click per tab was accepted on 2026-09-09; zero clicks is not a requirement.
Unproven until [the spike](plans/2026-09-09-capture-feasibility-spike.md) reports.

**2b.** What happens when that interface is unavailable, denied by the user, or changed by a browser update?

**Answer:** If one click per tab does not hold on managed Chrome 150, the extension is the wrong shape and the sketch is abandoned.
The two shapes that need no gesture are a DevTools-protocol screencast of a controlled Chrome and a native capture of the Chrome window, and they get their own plan.
A browser update changing the rule is a risk this project accepts and re-tests per Chrome release.

---

## 3. Shape and constraints

**3a.** Is this a browser extension, a native app, a service, or a library?

**Answer:** A Manifest V3 Chrome extension, plus a demo web application in the same repository that is the host during development.

**3b.** Which platforms and which versions, and which of those are actually tested?

**Answer:** Managed Chrome on macOS, installed through the admin console or Jamf.
Google Chrome 150.0.7871.101 on this Mac is the version tested until the fleet's version is known.
Windows and ChromeOS are out of scope.

**3c.** What is the dependency budget, and what is the licence?

**Answer:** TypeScript, Vite and Playwright, and nothing else during the spike.
The licence is MIT.

---

## 4. Failure and scale

**4a.** How long is the longest recording it must survive, and what bounds the disk it uses?

**Answer:** Under one hour.
The spool bound is a safety net rather than a design driver, and it is not set in the spike.

**4b.** What is the acceptable loss when the process dies mid-recording?

**Answer:** Up to one timeslice, five seconds by default, plus whatever was in the encoder.
Q2 of the spike measures the actual figure.

---

## 5. Distribution

**5a.** How does a user install it, and how does it update itself?

**Answer:** Force-installed by policy on the managed fleet, updated from wherever the `.crx` and its update manifest are served.
Whether that is the Chrome Web Store or a self-hosted URL is open, and Q4 of the spike records what a self-hosted URL needs on macOS.

**5b.** What is signed, notarized, or reviewed by a store, and who holds the credentials?

**Answer:** Open.
The packing key for the `.crx` is created in the spike and kept out of git; who holds it for the fleet is the client's call.
