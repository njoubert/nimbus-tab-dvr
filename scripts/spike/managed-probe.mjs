#!/usr/bin/env node
// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// Launches the real Google Chrome on a throwaway profile, so it reads this Mac's Chrome
// policies, and reports over the DevTools protocol what it made of them: which policies
// chrome://policy lists, whether the force-installed extension reached the demo page, what
// managed configuration it sees, and whether capture is granted without a gesture.
//
// Usage: node scripts/spike/managed-probe.mjs [extra Chrome flags...]
// Needs: scripts/spike/policy.sh install, and dist/backend/nimbus-demo-backend running.
// The profile is wiped on every run unless KEEP_PROFILE=1, which is how an extension loaded
// unpacked by hand in that profile survives to the next run.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = resolve('.build-chrome/probe-profile');
const PORT = 9333;
const DEMO = 'http://localhost:5173/';

const manifest = JSON.parse(readFileSync('dist/extension/manifest.json', 'utf8'));
const hex = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
const extensionId = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(`FINDING: ${line}`);

if (process.env.KEEP_PROFILE !== '1') rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(PROFILE, { recursive: true });

const extra = process.argv.slice(2);
setTimeout(() => {
  console.error('managed-probe: giving up after 150 s');
  process.exit(2);
}, 150_000).unref();
const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    ...extra,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let version = null;
for (let i = 0; i < 100 && !version; i++) {
  try {
    version = await (await fetch(`http://localhost:${PORT}/json/version`)).json();
  } catch {
    await sleep(200);
  }
}
if (!version) {
  console.error('Chrome did not open its debugging port');
  chrome.kill();
  process.exit(1);
}
say(`${version.Browser} launched on ${PROFILE} with flags [${extra.join(' ')}], extension id ${extensionId}`);

const browser = await chromium.connectOverCDP(`http://localhost:${PORT}`);
const context = browser.contexts()[0];

try {
  // The WebUI pages keep their content in shadow roots, so the record is a screenshot.
  mkdirSync('test-results/spike', { recursive: true });
  for (const [name, url] of [
    ['policy', 'chrome://policy'],
    ['extensions', 'chrome://extensions'],
  ]) {
    const page = await context.newPage();
    await page.goto(url);
    await sleep(2500);
    // The WebUI keeps its rows in shadow roots and ignores synthetic input from the DevTools
    // protocol, so the "Show more" toggles are clicked from inside the page and the rows'
    // text is gathered from every shadow root.
    const rows = await page.evaluate(() => {
      const roots = [];
      const collect = (root) => {
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) {
            roots.push(el.shadowRoot);
            collect(el.shadowRoot);
          }
        }
      };
      collect(document);
      for (const root of roots) {
        for (const el of root.querySelectorAll('*')) {
          if (el.childElementCount === 0 && el.textContent.trim() === 'Show more') el.click();
        }
      }
      const rows = [];
      for (const root of roots) {
        const text = [...root.children]
          .filter((c) => c.tagName !== 'STYLE')
          .map((c) => c.innerText ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (/ExtensionInstallForcelist|error|Error|Warning|BLOCKED/.test(text) && text.length < 2000) rows.push(text);
      }
      return rows;
    }).catch((e) => [`evaluate failed: ${e}`]);
    if (rows.length) say(`${url} rows: ${JSON.stringify([...new Set(rows)])}`);
    const path = `test-results/spike/managed-${name}${extra.length ? '-flagged' : ''}.png`;
    await page.screenshot({ path, fullPage: true });
    say(`${url} screenshot: ${path}`);
    await page.close();
  }

  const demo = await context.newPage();
  let state = 'missing';
  for (let attempt = 1; attempt <= 4 && state !== 'found'; attempt++) {
    await demo.goto(DEMO);
    await demo.locator('#extension:not([data-state="looking"])').waitFor({ timeout: 10_000 }).catch(() => {});
    state = (await demo.locator('#extension').getAttribute('data-state')) ?? 'unknown';
    if (state !== 'found') await sleep(3000);
  }
  say(`demo page sees the extension: ${state} (${await demo.locator('#extension').textContent()})`);

  if (state === 'found') {
    await demo.locator('#probe').click();
    await demo.locator('#probe-result[data-done="1"]').waitFor({ timeout: 10_000 });
    const ok = (await demo.locator('#probe-result').getAttribute('data-ok')) === '1';
    say(`capture probe with no gesture: ${ok ? 'GRANTED' : 'refused'} (${await demo.locator('#probe-result').textContent()})`);

    const consolePage = await context.newPage();
    await consolePage.goto(`chrome-extension://${extensionId}/console.html`);
    await sleep(1000);
    const status = await consolePage.evaluate(() => window.nimbusTabDvr.status());
    say(`service worker status: allowedOrigins=${JSON.stringify(status.allowedOrigins)} managedConfig=${JSON.stringify(status.managedConfig)}`);
    await consolePage.close();

    if (ok) {
      await demo.locator('#timeslice').fill('2000');
      await demo.locator('#start').click();
      await demo.locator('#status:not([data-type=""])').waitFor({ timeout: 20_000 });
      say(`START_RECORDING on real Chrome: ${await demo.locator('#status').textContent()}`);
      await sleep(5000);
      await demo.locator('#done').click();
      await demo.locator('#status[data-type^="RECORDING_"]').waitFor({ timeout: 20_000 });
      const status = await demo.locator('#status').textContent();
      say(`STOP_RECORDING on real Chrome: ${status}`);
    }
  }
  await demo.close();
} finally {
  await browser.close().catch(() => {});
  chrome.kill();
}
