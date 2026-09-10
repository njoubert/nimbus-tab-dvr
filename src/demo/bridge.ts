// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// What a host application needs to talk to the extension: post a request on the window,
// wait for the reply that carries the same requestId. This is the whole client.

import type { AppMessage, AppRequest, ExtensionMessage, ExtensionReply } from '../shared/protocol';

const APP_SOURCE = 'nimbus-tab-dvr/app';
const EXTENSION_SOURCE = 'nimbus-tab-dvr/extension';

let counter = 0;

// Omit over a union keeps only the common keys, so it is distributed over each member by hand.
type Body = AppRequest extends infer R ? (R extends AppRequest ? Omit<R, 'requestId'> : never) : never;

export function request(body: Body, timeoutMs = 15_000): Promise<ExtensionReply> {
  const requestId = `req_${Date.now()}_${++counter}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error(`no reply to ${body.type} within ${timeoutMs} ms`));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as Partial<ExtensionMessage> | null;
      if (!data || data.source !== EXTENSION_SOURCE || data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      const { source: _source, ...reply } = data as ExtensionMessage;
      resolve(reply);
    }
    window.addEventListener('message', onMessage);
    const message = { source: APP_SOURCE, requestId, ...body } as AppMessage;
    window.postMessage(message, window.location.origin);
  });
}

// The content script is injected at document_start, but a page that posts before it is
// listening gets silence, so a page pings until it hears back.
export async function waitForExtension(deadlineMs = 5000): Promise<ExtensionReply | null> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      return await request({ type: 'PING' }, 300);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return null;
}

export function log(line: string): void {
  const pre = document.querySelector<HTMLPreElement>('#log');
  if (!pre) return;
  pre.textContent += `${new Date().toISOString().slice(11, 23)} ${line}\n`;
}

export function showReply(element: HTMLElement, reply: ExtensionReply): void {
  element.dataset.type = reply.type;
  element.dataset.code = reply.type === 'RECORDING_ERROR' ? reply.code : '';
  element.textContent = JSON.stringify(reply);
  log(`${reply.type} ${JSON.stringify(reply)}`);
}

export function wireProbe(): void {
  const button = document.querySelector<HTMLButtonElement>('#probe');
  const out = document.querySelector<HTMLElement>('#probe-result');
  if (!button || !out) return;
  button.addEventListener('click', async () => {
    delete out.dataset.done;
    out.textContent = 'probing';
    const reply = await request({ type: 'PROBE_CAPTURE' });
    out.dataset.ok = reply.type === 'CAPTURE_PROBED' && reply.ok ? '1' : '0';
    out.dataset.done = '1';
    out.textContent = reply.type === 'CAPTURE_PROBED' ? reply.detail : JSON.stringify(reply);
    log(`probe: ${out.textContent}`);
  });
}

export async function announceExtension(): Promise<void> {
  const el = document.querySelector<HTMLElement>('#extension');
  if (!el) return;
  const pong = await waitForExtension();
  if (pong && pong.type === 'PONG') {
    el.dataset.state = 'found';
    el.textContent = `extension ${pong.extensionVersion} (${pong.extensionId}) is listening`;
  } else {
    el.dataset.state = 'missing';
    el.textContent = 'no extension answered on this page';
  }
}
