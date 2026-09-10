// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The control plane. It validates who is asking, asks Chrome for a capture stream id, keeps
// the one offscreen document alive, and records which tab is recording what. It holds nothing
// in memory it cannot rebuild from chrome.storage.session, because Chrome stops a service
// worker whenever it likes.

import type {
  AppRequest,
  CaptureOptions,
  ErrorCode,
  ExtensionEvent,
  ExtensionReply,
  FinishedRecording,
  Status,
  TabRecording,
  ToContentScript,
  ToOffscreen,
  ToServiceWorker,
} from '../shared/protocol';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const DEFAULT_API_BASE_URL = 'http://localhost:5173';

const DEFAULT_CAPTURE: CaptureOptions = {
  audio: false,
  targetFps: 15,
  maxWidth: 1920,
  maxHeight: 1080,
  videoBitsPerSecond: 3_000_000,
  timesliceMs: 5000,
};

const OFFSCREEN_URL = 'offscreen.html';
const LOG = '[nimbus-tab-dvr sw]';

interface ManagedConfig {
  allowedOrigins?: string[];
  apiBaseUrl?: string;
  capture?: Partial<CaptureOptions>;
}

interface SessionState {
  recordings: Record<string, TabRecording>;
  finished: Record<string, FinishedRecording>;
  invocations: { tabId: number; how: string; at: number }[];
}

async function session(): Promise<SessionState> {
  const stored = await chrome.storage.session.get(['recordings', 'finished', 'invocations']);
  return {
    recordings: (stored.recordings as Record<string, TabRecording>) ?? {},
    finished: (stored.finished as Record<string, FinishedRecording>) ?? {},
    invocations: (stored.invocations as SessionState['invocations']) ?? [],
  };
}

async function managedConfig(): Promise<ManagedConfig> {
  try {
    return (await chrome.storage.managed.get(null)) as ManagedConfig;
  } catch (error) {
    console.warn(LOG, 'managed storage unavailable', error);
    return {};
  }
}

async function allowedOrigins(): Promise<string[]> {
  const config = await managedConfig();
  return config.allowedOrigins?.length ? config.allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
}

// Managed configuration names the backend in a deployment; in development the console page
// writes an override to chrome.storage.local, and the demo server is the default.
async function apiBaseUrl(): Promise<string> {
  const config = await managedConfig();
  if (config.apiBaseUrl) return config.apiBaseUrl;
  const local = await chrome.storage.local.get('apiBaseUrl');
  return typeof local.apiBaseUrl === 'string' && local.apiBaseUrl ? local.apiBaseUrl : DEFAULT_API_BASE_URL;
}

async function captureOptions(overrides: Partial<CaptureOptions> | undefined): Promise<CaptureOptions> {
  const config = await managedConfig();
  return { ...DEFAULT_CAPTURE, ...(config.capture ?? {}), ...(overrides ?? {}) };
}

// Invocation is what Chrome checks before it hands out a stream id. These listeners exist so
// the console page can show that a click or a shortcut reached the extension; Chrome keeps
// its own record and this one has no effect on capture.
async function noteInvocation(tab: chrome.tabs.Tab | undefined, how: string): Promise<void> {
  if (tab?.id === undefined) return;
  const state = await session();
  state.invocations.push({ tabId: tab.id, how, at: Date.now() });
  await chrome.storage.session.set({ invocations: state.invocations.slice(-50) });
  console.log(LOG, 'invoked on tab', tab.id, 'by', how);
}

chrome.action.onClicked.addListener((tab) => {
  void noteInvocation(tab, 'action click');
});

chrome.commands.onCommand.addListener((command, tab) => {
  void noteInvocation(tab, `command ${command}`);
});

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
    justification: 'Encode the captured tab with MediaRecorder, spool it to IndexedDB and upload it',
  });
}

async function toOffscreen(message: ToOffscreen['message']): Promise<Record<string, unknown>> {
  const envelope: ToOffscreen = { target: 'offscreen', message };
  const reply = (await chrome.runtime.sendMessage(envelope)) as Record<string, unknown> | undefined;
  return reply ?? { ok: false, detail: 'the offscreen document did not reply' };
}

// An event to the page in a tab. The tab may be gone, in which case nobody needed it.
async function toTab(tabId: number, message: ExtensionEvent): Promise<void> {
  const envelope: ToContentScript = { target: 'content-script', message };
  try {
    await chrome.tabs.sendMessage(tabId, envelope);
  } catch (error) {
    console.log(LOG, 'no page to tell', message.type, 'on tab', tabId, String(error));
  }
}

function failure(
  requestId: string,
  code: ErrorCode,
  detail: string,
  recoverable: boolean,
  recordingKey?: string,
): ExtensionReply {
  console.warn(LOG, code, detail);
  return { type: 'RECORDING_ERROR', requestId, recordingKey, code, detail, recoverable };
}

async function requireAllowed(sender: chrome.runtime.MessageSender): Promise<string | null> {
  const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : '');
  const allowed = await allowedOrigins();
  return allowed.includes(origin) ? null : `origin ${origin} is not in allowedOrigins [${allowed.join(', ')}]`;
}

async function streamIdFor(tabId: number): Promise<{ streamId: string } | { error: string }> {
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    return { streamId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function start(
  request: Extract<AppRequest, { type: 'START_RECORDING' }>,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionReply> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return failure(request.requestId, 'NO_TAB', 'the request did not come from a tab', false);
  const denied = await requireAllowed(sender);
  if (denied) return failure(request.requestId, 'ORIGIN_NOT_ALLOWED', denied, false, request.recordingKey);

  const state = await session();
  const existing = state.recordings[String(tabId)];
  if (existing) {
    return failure(
      request.requestId,
      'ALREADY_RECORDING',
      `tab ${tabId} is already recording ${existing.recordingId} for key ${existing.recordingKey}`,
      false,
      request.recordingKey,
    );
  }

  const grant = await streamIdFor(tabId);
  if ('error' in grant) return failure(request.requestId, 'CAPTURE_FAILED', grant.error, true, request.recordingKey);

  await ensureOffscreen();
  const recordingId = crypto.randomUUID();
  const options = await captureOptions(request.options);
  const reply = await toOffscreen({
    type: 'start',
    streamId: grant.streamId,
    recordingId,
    recordingKey: request.recordingKey,
    options,
    apiBaseUrl: await apiBaseUrl(),
  });
  if (!reply.ok) {
    return failure(request.requestId, 'RECORDER_FAILED', String(reply.detail), true, request.recordingKey);
  }

  const recording: TabRecording = {
    recordingId,
    recordingKey: request.recordingKey,
    tabId,
    origin: sender.origin ?? '',
    startedAt: Date.now(),
    mimeType: String(reply.mimeType),
  };
  state.recordings[String(tabId)] = recording;
  delete state.finished[String(tabId)];
  await chrome.storage.session.set({ recordings: state.recordings, finished: state.finished });
  console.log(LOG, 'recording', recordingId, 'on tab', tabId, reply);

  return {
    type: 'RECORDING_STARTED',
    requestId: request.requestId,
    recordingKey: request.recordingKey,
    recordingId,
    mimeType: String(reply.mimeType),
    video: (reply.video as ExtensionReply extends { video: infer V } ? V : never) ?? {},
    audio: Boolean(reply.audio),
  };
}

// Moves a tab's live recording to its finished record. The offscreen document is asked to
// stop when it still holds the recording; when the capture ended on its own it already has.
async function finishRecording(
  tabId: string,
  how: { state: 'STOPPED' | 'ENDED'; reason?: string },
  askOffscreen: boolean,
): Promise<FinishedRecording | { error: ErrorCode; detail: string } | null> {
  const state = await session();
  const recording = state.recordings[tabId];
  if (!recording) return null;
  delete state.recordings[tabId];
  await chrome.storage.session.set({ recordings: state.recordings });

  let chunks = 0;
  let bytes = 0;
  if (askOffscreen) {
    if (!(await hasOffscreen())) {
      return {
        error: 'OFFSCREEN_GONE',
        detail: `the offscreen document that held ${recording.recordingId} is gone; its committed chunks are in IndexedDB`,
      };
    }
    const reply = await toOffscreen({ type: 'stop', recordingId: recording.recordingId, reason: how.reason });
    // A closing tab ends the captured track too, and whichever of the two arrives first wins;
    // the offscreen document saying it has already stopped is not a failure on that path.
    if (!reply.ok && how.state === 'STOPPED') return { error: 'RECORDER_FAILED', detail: String(reply.detail) };
    chunks = Number(reply.chunks ?? 0);
    bytes = Number(reply.bytes ?? 0);
  }

  const finished: FinishedRecording = { ...recording, ...how, chunks, bytes };
  state.finished[tabId] = finished;
  await chrome.storage.session.set({ finished: state.finished });
  console.log(LOG, how.state, recording.recordingId, how.reason ?? 'by request', { chunks, bytes });
  return finished;
}

async function stop(
  request: Extract<AppRequest, { type: 'STOP_RECORDING' }>,
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionReply> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return failure(request.requestId, 'NO_TAB', 'the request did not come from a tab', false);
  const denied = await requireAllowed(sender);
  if (denied) return failure(request.requestId, 'ORIGIN_NOT_ALLOWED', denied, false, request.recordingKey);

  const state = await session();
  const recording = state.recordings[String(tabId)];
  if (!recording || recording.recordingKey !== request.recordingKey) {
    return failure(
      request.requestId,
      'NOT_RECORDING',
      recording
        ? `tab ${tabId} is recording key ${recording.recordingKey}, not ${request.recordingKey}`
        : `tab ${tabId} is not recording`,
      false,
      request.recordingKey,
    );
  }

  const finished = await finishRecording(String(tabId), { state: 'STOPPED' }, true);
  if (!finished) return failure(request.requestId, 'NOT_RECORDING', `tab ${tabId} is not recording`, false, request.recordingKey);
  if ('error' in finished) return failure(request.requestId, finished.error, finished.detail, false, request.recordingKey);

  return {
    type: 'RECORDING_STOPPED',
    requestId: request.requestId,
    recordingKey: request.recordingKey,
    recordingId: recording.recordingId,
    chunks: finished.chunks,
    bytes: finished.bytes,
  };
}

function tabOf(state: SessionState, recordingId: string): string | undefined {
  const live = Object.entries(state.recordings).find(([, r]) => r.recordingId === recordingId);
  if (live) return live[0];
  const done = Object.entries(state.finished).find(([, r]) => r.recordingId === recordingId);
  return done?.[0];
}

async function captureEnded(recordingId: string, reason: string): Promise<void> {
  const state = await session();
  const tabId = tabOf(state, recordingId);
  if (tabId === undefined || !state.recordings[tabId]) return;
  const finished = await finishRecording(tabId, { state: 'ENDED', reason }, false);
  if (finished && !('error' in finished)) {
    await toTab(Number(tabId), { type: 'RECORDING_ENDED', recordingKey: finished.recordingKey, recordingId, reason });
  }
}

async function finalized(message: Extract<ToServiceWorker['message'], { type: 'RECORDING_FINALIZED' }>): Promise<void> {
  const state = await session();
  const tabId = tabOf(state, message.recordingId);
  if (tabId === undefined) return;
  const finished = state.finished[tabId];
  if (!finished) return;
  state.finished[tabId] = { ...finished, state: 'FINALIZED', chunks: message.chunks, bytes: message.bytes, url: message.url };
  await chrome.storage.session.set({ finished: state.finished });
  await toTab(Number(tabId), {
    type: 'RECORDING_FINALIZED',
    recordingKey: finished.recordingKey,
    recordingId: message.recordingId,
    chunks: message.chunks,
    bytes: message.bytes,
    url: message.url,
  });
}

// The tab is gone, so the recording stops through the same path a Done press takes, and its
// last chunks upload with no page there to see it.
chrome.tabs.onRemoved.addListener((tabId) => {
  void finishRecording(String(tabId), { state: 'ENDED', reason: 'tab-closed' }, true);
});

async function recordingStatus(requestId: string, sender: chrome.runtime.MessageSender): Promise<ExtensionReply> {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return failure(requestId, 'NO_TAB', 'the request did not come from a tab', false);
  const denied = await requireAllowed(sender);
  if (denied) return failure(requestId, 'ORIGIN_NOT_ALLOWED', denied, false);

  const state = await session();
  const live = state.recordings[String(tabId)];
  if (live) {
    const counts = (await hasOffscreen()) ? await toOffscreen({ type: 'status', recordingId: live.recordingId }) : { ok: false };
    return {
      type: 'RECORDING_STATUS',
      requestId,
      state: 'RECORDING',
      recordingKey: live.recordingKey,
      recordingId: live.recordingId,
      startedAt: live.startedAt,
      mimeType: live.mimeType,
      chunks: counts.ok ? Number(counts.chunks) : undefined,
      bytes: counts.ok ? Number(counts.bytes) : undefined,
      uploaded: counts.ok ? Number(counts.uploaded) : undefined,
    };
  }
  const done = state.finished[String(tabId)];
  if (done) {
    return {
      type: 'RECORDING_STATUS',
      requestId,
      state: done.state,
      recordingKey: done.recordingKey,
      recordingId: done.recordingId,
      startedAt: done.startedAt,
      mimeType: done.mimeType,
      chunks: done.chunks,
      bytes: done.bytes,
      reason: done.reason,
      url: done.url,
    };
  }
  return { type: 'RECORDING_STATUS', requestId, state: 'IDLE' };
}

async function status(): Promise<Status> {
  const state = await session();
  const config = await managedConfig();
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    chrome: navigator.userAgent,
    recordings: state.recordings,
    finished: state.finished,
    invocations: state.invocations,
    allowedOrigins: await allowedOrigins(),
    apiBaseUrl: await apiBaseUrl(),
    managedConfig: config,
    offscreen: await hasOffscreen(),
  };
}

async function handle(
  message: ToServiceWorker['message'],
  sender: chrome.runtime.MessageSender,
): Promise<ExtensionReply | Status | { ok: true }> {
  const fromExtension = sender.id === chrome.runtime.id && !sender.tab;
  switch (message.type) {
    case 'PING':
      return {
        type: 'PONG',
        requestId: message.requestId,
        extensionVersion: chrome.runtime.getManifest().version,
        extensionId: chrome.runtime.id,
      };
    case 'PROBE_CAPTURE': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return failure(message.requestId, 'NO_TAB', 'the request did not come from a tab', false);
      const denied = await requireAllowed(sender);
      if (denied) return failure(message.requestId, 'ORIGIN_NOT_ALLOWED', denied, false);
      const grant = await streamIdFor(tabId);
      return 'error' in grant
        ? { type: 'CAPTURE_PROBED', requestId: message.requestId, ok: false, detail: grant.error }
        : { type: 'CAPTURE_PROBED', requestId: message.requestId, ok: true, detail: 'Chrome issued a stream id' };
    }
    case 'GET_RECORDING_STATUS':
      return recordingStatus(message.requestId, sender);
    case 'START_RECORDING':
      return start(message, sender);
    case 'STOP_RECORDING':
      return stop(message, sender);
    case 'CAPTURE_ENDED':
      if (fromExtension) await captureEnded(message.recordingId, message.reason);
      return { ok: true };
    case 'RECORDING_FINALIZED':
      if (fromExtension) await finalized(message);
      return { ok: true };
    case 'STATUS':
      if (!fromExtension) return failure('', 'NO_TAB', 'status is for the extension itself', false);
      return status();
  }
}

chrome.runtime.onMessage.addListener((envelope: unknown, sender, sendResponse) => {
  const typed = envelope as Partial<ToServiceWorker> | null;
  if (!typed || typed.target !== 'service-worker' || !typed.message) return false;
  handle(typed.message, sender).then(sendResponse, (error: unknown) => {
    console.error(LOG, 'unhandled', error);
    const requestId = 'requestId' in typed.message! ? String(typed.message.requestId) : '';
    sendResponse(failure(requestId, 'RECORDER_FAILED', String(error), true));
  });
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log(LOG, 'installed', details.reason, chrome.runtime.getManifest().version);
});
