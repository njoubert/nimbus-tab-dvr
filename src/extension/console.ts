// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// An extension page for the spike: lists what the spool holds, assembles a recording into
// one file, and can kill the offscreen document to simulate a crash. It shares the
// extension's origin, so it reads the same IndexedDB the offscreen document writes.

import type { RecordingRecord, Status, ToServiceWorker } from '../shared/protocol';
import { deleteRecording, listChunks, listRecordings } from './db';

const tbody = document.querySelector<HTMLTableSectionElement>('#recordings tbody')!;
const statusPre = document.querySelector<HTMLPreElement>('#status')!;
const note = document.querySelector<HTMLSpanElement>('#note')!;

async function status(): Promise<Status> {
  const envelope: ToServiceWorker = { target: 'service-worker', message: { type: 'STATUS' } };
  return (await chrome.runtime.sendMessage(envelope)) as Status;
}

export async function assemble(recordingId: string): Promise<Blob> {
  const chunks = await listChunks(recordingId);
  const mimeType = chunks[0]?.mimeType ?? 'video/webm';
  return new Blob(
    chunks.map((chunk) => chunk.payload),
    { type: mimeType },
  );
}

async function download(recording: RecordingRecord): Promise<void> {
  const blob = await assemble(recording.recordingId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${recording.recordingKey}-${recording.recordingId.slice(0, 8)}.webm`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function render(): Promise<void> {
  const recordings = await listRecordings();
  tbody.replaceChildren();
  for (const recording of recordings) {
    const tr = document.createElement('tr');
    tr.dataset.recordingId = recording.recordingId;
    tr.append(
      cell(recording.recordingId.slice(0, 8)),
      cell(recording.recordingKey),
      cell(new Date(recording.createdAt).toISOString()),
      cell(recording.state + (recording.endedReason ? `: ${recording.endedReason}` : '')),
      cell(recording.mimeType),
      cell(String(recording.chunks)),
      cell(String(recording.bytes)),
    );
    const actions = document.createElement('td');
    const downloadButton = document.createElement('button');
    downloadButton.textContent = 'Download';
    downloadButton.className = 'download';
    downloadButton.onclick = () => void download(recording);
    const deleteButton = document.createElement('button');
    deleteButton.textContent = 'Delete';
    deleteButton.onclick = () => void deleteRecording(recording.recordingId).then(render);
    actions.append(downloadButton, deleteButton);
    tr.append(actions);
    tbody.append(tr);
  }
  statusPre.textContent = JSON.stringify(await status(), null, 2);
}

document.querySelector('#refresh')!.addEventListener('click', () => void render());
document.querySelector('#close-offscreen')!.addEventListener('click', () => {
  chrome.offscreen.closeDocument().then(
    () => {
      note.textContent = 'closed';
      void render();
    },
    (error: unknown) => {
      note.textContent = String(error);
    },
  );
});

// The test reaches the spool through this rather than through the DOM.
declare global {
  interface Window {
    nimbusTabDvr: {
      listRecordings: typeof listRecordings;
      listChunks: typeof listChunks;
      assemble: typeof assemble;
      status: typeof status;
    };
  }
}
window.nimbusTabDvr = { listRecordings, listChunks, assemble, status };

void render();
