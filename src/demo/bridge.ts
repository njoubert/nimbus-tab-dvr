// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// What a host application needs to talk to the extension: post a request on the window,
// wait for the reply that carries the same requestId, and listen for the events the
// extension posts unasked. This is the whole client.

import type { AppMessage, AppRequest, ExtensionEvent, ExtensionMessage, ExtensionReply } from '../shared/protocol';

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
      if (!data || data.source !== EXTENSION_SOURCE || !('requestId' in data) || data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      const { source: _source, ...reply } = data as ExtensionMessage;
      resolve(reply as ExtensionReply);
    }
    window.addEventListener('message', onMessage);
    const message = { source: APP_SOURCE, requestId, ...body } as AppMessage;
    window.postMessage(message, window.location.origin);
  });
}

// The extension posts RECORDING_FINALIZED and RECORDING_ENDED with no requestId, because no
// request asked for them.
export function onExtensionEvent(handler: (event: ExtensionEvent) => void): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as Partial<ExtensionMessage> | null;
    if (!data || data.source !== EXTENSION_SOURCE || 'requestId' in data) return;
    const { source: _source, ...rest } = data as ExtensionMessage;
    handler(rest as ExtensionEvent);
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

export function showReply(element: HTMLElement, reply: ExtensionReply | ExtensionEvent): void {
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

// What the backend knows about a recording; the demo server's meta.json, as it lists them.
export interface BackendRecording {
  id: string;
  key: string;
  mimeType: string;
  startedAt: number;
  state: 'recording' | 'finalized' | 'failed';
  chunks: number;
  bytes: number;
  lastChunkAt?: number;
  finalizedAt?: number;
  durationSeconds?: number | null;
  reason?: string;
  url?: string;
}

export async function listBackendRecordings(): Promise<BackendRecording[]> {
  const response = await fetch('/api/recordings', { cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as BackendRecording[];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
