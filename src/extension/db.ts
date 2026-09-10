// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The durable spool. Every encoded chunk lands here before anything else happens to it, keyed
// by recording and sequence, so a recording can be reassembled by whoever survives.

import type { ChunkRecord, RecordingRecord } from '../shared/protocol';

const DB_NAME = 'nimbus-tab-dvr';
const DB_VERSION = 1;

let opened: Promise<IDBDatabase> | undefined;

export function openDb(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('recordings', { keyPath: 'recordingId' });
      const chunks = db.createObjectStore('chunks', { keyPath: ['recordingId', 'sequence'] });
      chunks.createIndex('byRecording', 'recordingId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return opened;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putRecording(record: RecordingRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('recordings', 'readwrite');
  tx.objectStore('recordings').put(record);
  await done(tx);
}

export async function getRecording(recordingId: string): Promise<RecordingRecord | undefined> {
  const db = await openDb();
  return result(db.transaction('recordings').objectStore('recordings').get(recordingId) as IDBRequest<RecordingRecord | undefined>);
}

export async function updateRecording(recordingId: string, patch: Partial<RecordingRecord>): Promise<void> {
  const existing = await getRecording(recordingId);
  if (!existing) return;
  await putRecording({ ...existing, ...patch });
}

export async function putChunk(chunk: ChunkRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('chunks', 'readwrite');
  tx.objectStore('chunks').put(chunk);
  await done(tx);
}

export async function updateChunk(recordingId: string, sequence: number, patch: Partial<ChunkRecord>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('chunks', 'readwrite');
  const store = tx.objectStore('chunks');
  const existing = await result(store.get([recordingId, sequence]) as IDBRequest<ChunkRecord | undefined>);
  if (existing) store.put({ ...existing, ...patch });
  await done(tx);
}

export async function listRecordings(): Promise<RecordingRecord[]> {
  const db = await openDb();
  const all = await result(db.transaction('recordings').objectStore('recordings').getAll() as IDBRequest<RecordingRecord[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listChunks(recordingId: string): Promise<ChunkRecord[]> {
  const db = await openDb();
  const index = db.transaction('chunks').objectStore('chunks').index('byRecording');
  const all = await result(index.getAll(recordingId) as IDBRequest<ChunkRecord[]>);
  return all.sort((a, b) => a.sequence - b.sequence);
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['recordings', 'chunks'], 'readwrite');
  tx.objectStore('recordings').delete(recordingId);
  const chunks = tx.objectStore('chunks');
  const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Number.MAX_SAFE_INTEGER]);
  chunks.delete(range);
  await done(tx);
}
