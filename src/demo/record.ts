// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

import { announceExtension, log, request, showReply, waitForExtension, wireProbe } from './bridge';

const params = new URLSearchParams(window.location.search);
const audio = params.get('audio') === '1';
const timesliceMs = Number(params.get('timeslice') ?? 5000);

// The key lives in sessionStorage so a reload of this page asks about the same recording
// rather than starting a second one under a new name.
const recordingKey = sessionStorage.getItem('recordingKey') ?? `rec_${Date.now()}`;
sessionStorage.setItem('recordingKey', recordingKey);

const status = document.querySelector<HTMLElement>('#status')!;

async function start(): Promise<void> {
  status.textContent = 'starting';
  status.dataset.type = '';
  const reply = await request({
    type: 'START_RECORDING',
    recordingKey,
    metadata: { page: 'record', audio, timesliceMs },
    options: { audio, timesliceMs },
  });
  showReply(status, reply);
}

async function stop(): Promise<void> {
  status.textContent = 'stopping';
  status.dataset.type = '';
  const reply = await request({ type: 'STOP_RECORDING', recordingKey });
  showReply(status, reply);
  sessionStorage.setItem('lastReply', JSON.stringify(reply));
  sessionStorage.removeItem('recordingKey');
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 1500);
}

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
  if (await waitForExtension()) {
    await start();
  } else {
    status.textContent = 'the extension is not on this page';
    status.dataset.type = 'NO_EXTENSION';
    log('no extension');
  }
})();
