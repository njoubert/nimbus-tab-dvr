// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

import { announceExtension, log, wireProbe } from './bridge';

const last = sessionStorage.getItem('lastReply');
if (last) {
  const el = document.querySelector<HTMLElement>('#last')!;
  el.textContent = `last reply: ${last}`;
  el.dataset.type = JSON.parse(last).type;
}

document.querySelector<HTMLButtonElement>('#start')!.addEventListener('click', () => {
  const audio = document.querySelector<HTMLInputElement>('#audio')!.checked ? '1' : '0';
  const timeslice = document.querySelector<HTMLInputElement>('#timeslice')!.value;
  const key = `rec_${Date.now()}`;
  sessionStorage.setItem('recordingKey', key);
  log(`starting ${key} audio=${audio} timeslice=${timeslice}`);
  window.location.href = `record.html?audio=${audio}&timeslice=${timeslice}`;
});

wireProbe();
void announceExtension();
