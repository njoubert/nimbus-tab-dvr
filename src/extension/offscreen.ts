// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The data plane. It turns a stream id into a MediaStream, encodes it with MediaRecorder,
// and writes every timeslice to IndexedDB as it arrives. One recording at a time.

import type { CaptureOptions, ToOffscreen, ToServiceWorker } from '../shared/protocol';
import { putChunk, putRecording, updateRecording } from './db';

const LOG = '[nimbus-tab-dvr offscreen]';

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

interface Active {
  recordingId: string;
  recordingKey: string;
  stream: MediaStream;
  recorder: MediaRecorder;
  audioContext?: AudioContext;
  mimeType: string;
  sequence: number;
  bytes: number;
  writes: Promise<void>[];
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
    stream,
    recorder,
    audioContext,
    mimeType: recorder.mimeType || mimeType,
    sequence: 0,
    bytes: 0,
    writes: [],
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
  };

  recorder.onerror = (event) => {
    console.error(LOG, 'recorder error', event);
  };

  // The tab closing, or Chrome revoking the capture, ends the track. The recorder is told
  // to flush what it has and the service worker is told the recording is over.
  videoTrack.addEventListener('ended', () => {
    void endBecause('the captured track ended');
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

async function stop(message: Extract<ToOffscreen['message'], { type: 'stop' }>): Promise<Record<string, unknown>> {
  const state = active;
  if (!state || state.recordingId !== message.recordingId) {
    return { ok: false, detail: state ? `recording ${state.recordingId}, not ${message.recordingId}` : 'not recording' };
  }
  active = undefined;
  const totals = await finish(state);
  await updateRecording(state.recordingId, { state: 'STOPPED', ...totals });
  console.log(LOG, 'stopped', state.recordingId, totals);
  return { ok: true, ...totals };
}

async function endBecause(reason: string): Promise<void> {
  const state = active;
  if (!state || state.ended) return;
  state.ended = true;
  active = undefined;
  const totals = await finish(state);
  await updateRecording(state.recordingId, { state: 'ENDED', endedReason: reason, ...totals });
  await tellServiceWorker({ type: 'CAPTURE_ENDED', recordingId: state.recordingId, reason });
}

chrome.runtime.onMessage.addListener((envelope: unknown, _sender, sendResponse) => {
  const typed = envelope as Partial<ToOffscreen> | null;
  if (!typed || typed.target !== 'offscreen' || !typed.message) return false;
  const message = typed.message;
  const work = message.type === 'start' ? start(message) : stop(message);
  work.then(sendResponse, (error: unknown) => {
    console.error(LOG, message.type, 'failed', error);
    sendResponse({ ok: false, detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  });
  return true;
});
