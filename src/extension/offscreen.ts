// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The data plane. It turns a stream id into a MediaStream, encodes it with MediaRecorder,
// writes every timeslice to IndexedDB as it arrives, and uploads each one to the backend in
// order once it is durable. One recording at a time; a stopped recording's upload tail runs
// on after the next one starts.

import type { CaptureOptions, ToOffscreen, ToServiceWorker } from '../shared/protocol';
import { putChunk, putRecording, updateChunk, updateRecording } from './db';

const LOG = '[nimbus-tab-dvr offscreen]';

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

interface Active {
  recordingId: string;
  recordingKey: string;
  apiBaseUrl: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  audioContext?: AudioContext;
  mimeType: string;
  sequence: number;
  bytes: number;
  uploaded: number;
  writes: Promise<void>[];
  uploads: Promise<void>;
  ended: boolean;
}

let active: Active | undefined;

function pickMimeType(preferred: string | undefined): string {
  const candidates = preferred ? [preferred, ...MIME_CANDIDATES] : MIME_CANDIDATES;
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

// Chrome's tab-capture constraints are the legacy `mandatory` form, which the DOM types do not
// know about, so the object is built untyped on purpose.
function constraints(streamId: string, options: CaptureOptions): MediaStreamConstraints {
  const source = { chromeMediaSource: 'tab', chromeMediaSourceId: streamId };
  return {
    audio: options.audio ? { mandatory: { ...source } } : false,
    video: {
      mandatory: {
        ...source,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        maxFrameRate: options.targetFps,
      },
    },
  } as unknown as MediaStreamConstraints;
}

async function tellServiceWorker(message: ToServiceWorker['message']): Promise<void> {
  const envelope: ToServiceWorker = { target: 'service-worker', message };
  await chrome.runtime.sendMessage(envelope);
}

// One chunk to the backend. A failure is recorded and logged and the recording carries on;
// the demo has no retry, so a backend that is down shows up as failed chunks in the console.
async function upload(state: Active, sequence: number, data: Blob): Promise<void> {
  const url = `${state.apiBaseUrl}/api/recordings/${state.recordingId}/chunks/${sequence}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      body: data,
      headers: { 'content-type': state.mimeType || 'video/webm', 'x-recording-key': state.recordingKey },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    state.uploaded += 1;
    await updateChunk(state.recordingId, sequence, { uploadState: 'uploaded' });
    await updateRecording(state.recordingId, { uploaded: state.uploaded });
  } catch (error) {
    console.error(LOG, 'upload failed', sequence, error);
    await updateChunk(state.recordingId, sequence, { uploadState: 'failed', retryCount: 1 });
  }
}

async function start(message: Extract<ToOffscreen['message'], { type: 'start' }>): Promise<Record<string, unknown>> {
  if (active) return { ok: false, detail: `already recording ${active.recordingId}` };

  const stream = await navigator.mediaDevices.getUserMedia(constraints(message.streamId, message.options));
  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0];

  // Capturing a tab's audio takes it away from the speakers. Playing the captured track back
  // through an AudioContext is what gives it back, and Q3 of the spike measures whether it does.
  let audioContext: AudioContext | undefined;
  if (audioTrack) {
    audioContext = new AudioContext();
    audioContext.createMediaStreamSource(stream).connect(audioContext.destination);
  }

  const mimeType = pickMimeType(message.options.mimeType);
  const recorder = new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
    videoBitsPerSecond: message.options.videoBitsPerSecond,
  });

  const state: Active = {
    recordingId: message.recordingId,
    recordingKey: message.recordingKey,
    apiBaseUrl: message.apiBaseUrl.replace(/\/$/, ''),
    stream,
    recorder,
    audioContext,
    mimeType: recorder.mimeType || mimeType,
    sequence: 0,
    bytes: 0,
    uploaded: 0,
    writes: [],
    uploads: Promise.resolve(),
    ended: false,
  };
  active = state;

  await putRecording({
    recordingId: state.recordingId,
    recordingKey: state.recordingKey,
    createdAt: Date.now(),
    mimeType: state.mimeType,
    audio: Boolean(audioTrack),
    state: 'RECORDING',
    chunks: 0,
    bytes: 0,
    uploaded: 0,
  });

  recorder.ondataavailable = ({ data }) => {
    if (data.size === 0) return;
    const sequence = ++state.sequence;
    state.bytes += data.size;
    const write = putChunk({
      recordingId: state.recordingId,
      recordingKey: state.recordingKey,
      sequence,
      createdAt: Date.now(),
      mimeType: state.mimeType,
      byteLength: data.size,
      payload: data,
      uploadState: 'queued',
      retryCount: 0,
    }).then(() => updateRecording(state.recordingId, { chunks: state.sequence, bytes: state.bytes }));
    state.writes.push(write);
    write.catch((error: unknown) => console.error(LOG, 'chunk write failed', sequence, error));
    // Uploads chain in sequence behind the write, one in flight, so the backend sees them in order.
    state.uploads = state.uploads.then(() => write.catch(() => undefined)).then(() => upload(state, sequence, data));
  };

  recorder.onerror = (event) => {
    console.error(LOG, 'recorder error', event);
  };

  // The tab closing, or Chrome revoking the capture, ends the track. The recorder is told
  // to flush what it has and the service worker is told the recording is over.
  videoTrack.addEventListener('ended', () => {
    void endBecause('capture-ended');
  });

  recorder.start(message.options.timesliceMs);
  console.log(LOG, 'recording', state.recordingId, state.mimeType, videoTrack.getSettings());

  const settings = videoTrack.getSettings();
  return {
    ok: true,
    mimeType: state.mimeType,
    audio: Boolean(audioTrack),
    video: { width: settings.width, height: settings.height, frameRate: settings.frameRate },
  };
}

async function finish(state: Active): Promise<{ chunks: number; bytes: number }> {
  if (state.recorder.state !== 'inactive') {
    await new Promise<void>((resolve) => {
      state.recorder.addEventListener('stop', () => resolve(), { once: true });
      state.recorder.stop();
    });
  }
  await Promise.allSettled(state.writes);
  for (const track of state.stream.getTracks()) track.stop();
  await state.audioContext?.close();
  return { chunks: state.sequence, bytes: state.bytes };
}

// The tail after a stop: wait for the last upload, tell the backend it has everything, and
// tell the service worker the recording is finalized. Runs after the stop reply has gone out.
async function finalize(state: Active, totals: { chunks: number; bytes: number }, reason: string | undefined): Promise<void> {
  await state.uploads;
  if (state.uploaded !== totals.chunks) {
    console.warn(LOG, 'not finalizing', state.recordingId, `${state.uploaded} of ${totals.chunks} chunks uploaded`);
    return;
  }
  try {
    const response = await fetch(`${state.apiBaseUrl}/api/recordings/${state.recordingId}/stop`, {
      method: 'POST',
      body: JSON.stringify({ ...totals, reason }),
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const meta = (await response.json()) as { url?: string };
    const url = `${state.apiBaseUrl}${meta.url ?? ''}`;
    await updateRecording(state.recordingId, { state: 'FINALIZED', url });
    await tellServiceWorker({ type: 'RECORDING_FINALIZED', recordingId: state.recordingId, ...totals, url });
    console.log(LOG, 'finalized', state.recordingId, url);
  } catch (error) {
    console.error(LOG, 'finalize failed', state.recordingId, error);
  }
}

async function stop(message: Extract<ToOffscreen['message'], { type: 'stop' }>): Promise<Record<string, unknown>> {
  const state = active;
  if (!state || state.recordingId !== message.recordingId) {
    return { ok: false, detail: state ? `recording ${state.recordingId}, not ${message.recordingId}` : 'not recording' };
  }
  active = undefined;
  state.ended = true;
  const totals = await finish(state);
  await updateRecording(state.recordingId, {
    state: message.reason ? 'ENDED' : 'STOPPED',
    endedReason: message.reason,
    ...totals,
  });
  console.log(LOG, 'stopped', state.recordingId, message.reason ?? 'by request', totals);
  void finalize(state, totals, message.reason);
  return { ok: true, ...totals, uploaded: state.uploaded };
}

async function endBecause(reason: string): Promise<void> {
  const state = active;
  if (!state || state.ended) return;
  state.ended = true;
  active = undefined;
  const totals = await finish(state);
  await updateRecording(state.recordingId, { state: 'ENDED', endedReason: reason, ...totals });
  await tellServiceWorker({ type: 'CAPTURE_ENDED', recordingId: state.recordingId, reason });
  await finalize(state, totals, reason);
}

function status(message: Extract<ToOffscreen['message'], { type: 'status' }>): Record<string, unknown> {
  const state = active;
  if (!state || state.recordingId !== message.recordingId) return { ok: false, detail: 'not recording' };
  return { ok: true, chunks: state.sequence, bytes: state.bytes, uploaded: state.uploaded, mimeType: state.mimeType };
}

chrome.runtime.onMessage.addListener((envelope: unknown, _sender, sendResponse) => {
  const typed = envelope as Partial<ToOffscreen> | null;
  if (!typed || typed.target !== 'offscreen' || !typed.message) return false;
  const message = typed.message;
  const work =
    message.type === 'start' ? start(message) : message.type === 'stop' ? stop(message) : Promise.resolve(status(message));
  work.then(sendResponse, (error: unknown) => {
    console.error(LOG, message.type, 'failed', error);
    sendResponse({ ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  });
  return true;
});
