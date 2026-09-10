// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

import { announceExtension, log, onExtensionEvent, request, showReply, waitForExtension, wireProbe } from './bridge';

const params = new URLSearchParams(window.location.search);
const audio = params.get('audio') === '1';
const timesliceMs = Number(params.get('timeslice') ?? 5000);

const status = document.querySelector<HTMLElement>('#status')!;
const hint = document.querySelector<HTMLElement>('#hint')!;

// The extension is the source of truth for the recording's identity: a page asks on load and
// joins what it finds, so a reload never starts a second recording under a new name.
let recordingKey: string | undefined;
let leaveTimer: number | undefined;

function leave(afterMs: number): void {
  clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    window.location.href = 'index.html';
  }, afterMs);
}

async function start(): Promise<void> {
  status.textContent = 'starting';
  status.dataset.type = '';
  hint.hidden = true;
  recordingKey = `rec_${Date.now()}`;
  const reply = await request({
    type: 'START_RECORDING',
    recordingKey,
    metadata: { page: 'record', audio, timesliceMs },
    options: { audio, timesliceMs },
  });
  showReply(status, reply);
  if (reply.type === 'RECORDING_ERROR' && reply.code === 'CAPTURE_FAILED' && reply.detail.includes('has not been invoked')) {
    hint.hidden = false;
  }
}

async function join(): Promise<boolean> {
  const reply = await request({ type: 'GET_RECORDING_STATUS' });
  if (reply.type !== 'RECORDING_STATUS' || reply.state !== 'RECORDING') return false;
  recordingKey = reply.recordingKey;
  showReply(status, reply);
  log(`rejoined ${reply.recordingKey}: ${reply.chunks ?? '?'} chunks so far`);
  return true;
}

async function stop(): Promise<void> {
  if (!recordingKey) return;
  status.textContent = 'stopping';
  status.dataset.type = '';
  const reply = await request({ type: 'STOP_RECORDING', recordingKey });
  showReply(status, reply);
  sessionStorage.setItem('lastReply', JSON.stringify(reply));
  // The finalized event follows once the backend has the last chunk; the page waits for it
  // and leaves on its own if the backend never answers.
  leave(reply.type === 'RECORDING_STOPPED' ? 10_000 : 1500);
}

onExtensionEvent((event) => {
  showReply(status, event);
  sessionStorage.setItem('lastReply', JSON.stringify(event));
  if (event.type === 'RECORDING_FINALIZED') leave(1500);
});

document.querySelector('#done')!.addEventListener('click', () => void stop());
document.querySelector('#retry')!.addEventListener('click', () => void start());
wireProbe();

// Motion on the canvas whether or not anyone draws, so every frame differs from the last.
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const ctx = canvas.getContext('2d')!;
let x = 50;
let y = 50;
let dx = 3;
let dy = 2;
const strokes: { x: number; y: number }[][] = [];
let drawing = false;

canvas.addEventListener('mousedown', (event) => {
  drawing = true;
  strokes.push([{ x: event.offsetX, y: event.offsetY }]);
});
canvas.addEventListener('mousemove', (event) => {
  if (drawing) strokes[strokes.length - 1].push({ x: event.offsetX, y: event.offsetY });
});
window.addEventListener('mouseup', () => {
  drawing = false;
});

function frame(): void {
  ctx.fillStyle = '#10233a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 3;
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach((point, i) => (i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.stroke();
  }
  x += dx;
  y += dy;
  if (x < 20 || x > canvas.width - 20) dx = -dx;
  if (y < 20 || y > canvas.height - 20) dy = -dy;
  ctx.fillStyle = '#ef476f';
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '20px system-ui';
  ctx.fillText(new Date().toISOString().slice(11, 23), 12, 30);
  requestAnimationFrame(frame);
}
frame();

void (async () => {
  await announceExtension();
  if (!(await waitForExtension())) {
    status.textContent = 'the extension is not on this page';
    status.dataset.type = 'NO_EXTENSION';
    log('no extension');
    return;
  }
  if (!(await join())) await start();
})();
