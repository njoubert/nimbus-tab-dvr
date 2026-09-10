// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The bridge between the page and the service worker. It relays a request from the page's
// window to the service worker and posts the reply back where it came from, and posts the
// events the service worker sends this tab unasked; nothing else, so the page never holds a
// channel to the extension it could misuse.
//
// This file is a classic script, not a module: it may import types and nothing else.

import type { AppMessage, ExtensionEvent, ExtensionMessage, ExtensionReply, ToContentScript, ToServiceWorker } from '../shared/protocol';

const APP_SOURCE = 'nimbus-tab-dvr/app';
const EXTENSION_SOURCE = 'nimbus-tab-dvr/extension';

function post(reply: ExtensionReply | ExtensionEvent): void {
  const message: ExtensionMessage = { source: EXTENSION_SOURCE, ...reply };
  window.postMessage(message, window.location.origin);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as Partial<AppMessage> | null;
  if (!data || data.source !== APP_SOURCE || typeof data.type !== 'string') return;
  const { source: _source, ...request } = data as AppMessage;
  const envelope: ToServiceWorker = { target: 'service-worker', message: request };
  chrome.runtime
    .sendMessage(envelope)
    .then((reply: ExtensionReply | undefined) => {
      if (reply) post(reply);
    })
    .catch((error: unknown) => {
      post({
        type: 'RECORDING_ERROR',
        requestId: request.requestId,
        code: 'EXTENSION_UNREACHABLE',
        detail: String(error),
        recoverable: true,
      });
    });
});

chrome.runtime.onMessage.addListener((envelope: unknown) => {
  const typed = envelope as Partial<ToContentScript> | null;
  if (!typed || typed.target !== 'content-script' || !typed.message) return false;
  post(typed.message);
  return false;
});
