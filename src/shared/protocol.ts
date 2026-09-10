// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The messages between the host application and the extension, and between the extension's
// own contexts. Types only: the content script imports this file, and a content script is a
// classic script that cannot import code, so nothing here may survive compilation.

export type AppSource = 'nimbus-tab-dvr/app';
export type ExtensionSource = 'nimbus-tab-dvr/extension';

export interface CaptureOptions {
  audio: boolean;
  targetFps: number;
  maxWidth: number;
  maxHeight: number;
  videoBitsPerSecond: number;
  timesliceMs: number;
  mimeType?: string;
}

// What the application sends. `options` is accepted only so the spike can vary the capture
// from the page; a deployment takes them from managed configuration.
export type AppRequest =
  | { type: 'PING'; requestId: string }
  | { type: 'PROBE_CAPTURE'; requestId: string }
  | {
      type: 'START_RECORDING';
      requestId: string;
      recordingKey: string;
      metadata?: Record<string, unknown>;
      options?: Partial<CaptureOptions>;
    }
  | { type: 'STOP_RECORDING'; requestId: string; recordingKey: string };

export type ErrorCode =
  | 'ORIGIN_NOT_ALLOWED'
  | 'NO_TAB'
  | 'ALREADY_RECORDING'
  | 'NOT_RECORDING'
  | 'CAPTURE_FAILED'
  | 'RECORDER_FAILED'
  | 'OFFSCREEN_GONE'
  | 'EXTENSION_UNREACHABLE';

export type ExtensionReply =
  | { type: 'PONG'; requestId: string; extensionVersion: string; extensionId: string }
  | { type: 'CAPTURE_PROBED'; requestId: string; ok: boolean; detail: string }
  | {
      type: 'RECORDING_STARTED';
      requestId: string;
      recordingKey: string;
      recordingId: string;
      mimeType: string;
      video: { width?: number; height?: number; frameRate?: number };
      audio: boolean;
    }
  | {
      type: 'RECORDING_STOPPED';
      requestId: string;
      recordingKey: string;
      recordingId: string;
      chunks: number;
      bytes: number;
    }
  | {
      type: 'RECORDING_ERROR';
      requestId: string;
      recordingKey?: string;
      code: ErrorCode;
      detail: string;
      recoverable: boolean;
    };

// The envelope on the page's window. Both directions carry a `source` so a page script can
// tell its own messages from the extension's.
export type AppMessage = AppRequest & { source: AppSource };
export type ExtensionMessage = ExtensionReply & { source: ExtensionSource };

// Inside the extension every runtime message names its target, because the service worker,
// the offscreen document and the console page all listen on the same channel.
export type ToServiceWorker = {
  target: 'service-worker';
  message: AppRequest | { type: 'CAPTURE_ENDED'; recordingId: string; reason: string } | { type: 'STATUS' };
};

export type ToOffscreen = {
  target: 'offscreen';
  message:
    | { type: 'start'; streamId: string; recordingId: string; recordingKey: string; options: CaptureOptions }
    | { type: 'stop'; recordingId: string };
};

export interface RecordingRecord {
  recordingId: string;
  recordingKey: string;
  createdAt: number;
  mimeType: string;
  audio: boolean;
  state: 'RECORDING' | 'STOPPED' | 'ENDED';
  chunks: number;
  bytes: number;
  endedReason?: string;
}

export interface ChunkRecord {
  recordingId: string;
  recordingKey: string;
  sequence: number;
  createdAt: number;
  mimeType: string;
  byteLength: number;
  payload: Blob;
  uploadState: 'queued';
  retryCount: number;
}

export interface TabRecording {
  recordingId: string;
  recordingKey: string;
  tabId: number;
  origin: string;
  startedAt: number;
  mimeType: string;
}

export interface Status {
  extensionVersion: string;
  chrome: string;
  recordings: Record<string, TabRecording>;
  invocations: { tabId: number; how: string; at: number }[];
  allowedOrigins: string[];
  managedConfig: unknown;
  offscreen: boolean;
}
