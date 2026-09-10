#!/usr/bin/env node
// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// The demo backend: a stand-in for the client's. It serves the built demo on 5173 and, on the
// same origin, a recordings API that takes each chunk as the extension produces it, remuxes
// the whole with ffmpeg at stop so the file has a duration and cues, and serves the result
// with range requests so a scrubber works. The packed extension is served on 8765 for the
// managed-install tools in scripts/spike.
//
// Usage: node scripts/demo/serve.mjs
//
// Recordings live under .build-demo/recordings/<id>/: the raw chunks by sequence, meta.json,
// and recording.webm once finalized.
//
//   POST   /api/recordings/:id/chunks/:sequence   body: the chunk; headers: x-recording-key, content-type
//   POST   /api/recordings/:id/stop               body: { chunks, bytes, reason? }
//   GET    /api/recordings                        every meta.json, newest first
//   GET    /api/recordings/:id.webm               the finalized file, range requests honoured
//   DELETE /api/recordings/:id

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.crx': 'application/x-chrome-extension',
  '.webm': 'video/webm',
};

const RECORDINGS = resolve('.build-demo/recordings');
const ID = /^[A-Za-z0-9-]{1,64}$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, x-recording-key',
};

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const parts = [];
    request.on('data', (part) => parts.push(part));
    request.on('end', () => resolveBody(Buffer.concat(parts)));
    request.on('error', reject);
  });
}

async function readMeta(id) {
  try {
    return JSON.parse(await readFile(join(RECORDINGS, id, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function writeMeta(meta) {
  await writeFile(join(RECORDINGS, meta.id, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (error) => resolveRun({ ok: false, out, err: `${error.message}\n${err}` }));
    child.on('close', (code) => resolveRun({ ok: code === 0, out, err }));
  });
}

// The raw chunks concatenate into the WebM MediaRecorder produced, which carries no duration
// and no cues; a copy remux through ffmpeg writes both, and ffprobe reads the duration back.
async function finalize(id, body) {
  const meta = await readMeta(id);
  if (!meta) return { status: 404, body: { error: `no recording ${id}` } };
  if (meta.state === 'finalized') return { status: 200, body: meta };
  const dir = join(RECORDINGS, id);
  const chunks = (await readdir(dir)).filter((name) => name.endsWith('.chunk')).sort();
  const raw = join(dir, 'raw.webm');
  const parts = [];
  for (const name of chunks) parts.push(await readFile(join(dir, name)));
  await writeFile(raw, Buffer.concat(parts));
  const remux = await run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c', 'copy', join(dir, 'recording.webm')]);
  if (!remux.ok) {
    await writeMeta({ ...meta, state: 'failed', reason: `ffmpeg: ${remux.err.trim()}` });
    return { status: 500, body: await readMeta(id) };
  }
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(dir, 'recording.webm')]);
  const finalized = await writeMeta({
    ...meta,
    state: 'finalized',
    finalizedAt: Date.now(),
    chunks: chunks.length,
    bytes: parts.reduce((n, part) => n + part.length, 0),
    reason: body.reason ?? meta.reason,
    durationSeconds: probe.ok ? Number(probe.out.trim()) : null,
    url: `/api/recordings/${id}.webm`,
  });
  console.log(`finalized ${id}: ${finalized.chunks} chunks, ${finalized.bytes} bytes, ${finalized.durationSeconds} s`);
  return { status: 200, body: finalized };
}

async function storeChunk(id, sequence, request) {
  const dir = join(RECORDINGS, id);
  await mkdir(dir, { recursive: true });
  const payload = await readBody(request);
  await writeFile(join(dir, `${String(sequence).padStart(6, '0')}.chunk`), payload);
  const existing = await readMeta(id);
  const meta = existing ?? {
    id,
    key: request.headers['x-recording-key'] ?? '',
    mimeType: request.headers['content-type'] ?? 'video/webm',
    startedAt: Date.now(),
    state: 'recording',
    chunks: 0,
    bytes: 0,
  };
  meta.chunks = Math.max(meta.chunks, sequence);
  meta.bytes += payload.length;
  meta.lastChunkAt = Date.now();
  return writeMeta(meta);
}

async function listRecordings() {
  await mkdir(RECORDINGS, { recursive: true });
  const ids = await readdir(RECORDINGS);
  const metas = [];
  for (const id of ids) {
    const meta = await readMeta(id);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.startedAt - a.startedAt);
}

function serveFile(request, response, path, headers = {}) {
  const size = statSync(path).size;
  const type = TYPES[extname(path)] ?? 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      response.writeHead(416, { 'content-range': `bytes */${size}`, ...headers });
      response.end();
      return;
    }
    response.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      ...headers,
    });
    createReadStream(path, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    ...headers,
  });
  createReadStream(path).pipe(response);
}

async function api(request, response, url) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, CORS);
    response.end();
    return;
  }
  const chunk = /^\/api\/recordings\/([^/]+)\/chunks\/(\d+)$/.exec(url.pathname);
  const stop = /^\/api\/recordings\/([^/]+)\/stop$/.exec(url.pathname);
  const file = /^\/api\/recordings\/([^/]+)\.webm$/.exec(url.pathname);
  const one = /^\/api\/recordings\/([^/]+)$/.exec(url.pathname);
  const id = (chunk ?? stop ?? file ?? one)?.[1];
  if (id !== undefined && !ID.test(id)) {
    json(response, 400, { error: 'bad recording id' });
    return;
  }
  if (url.pathname === '/api/recordings' && request.method === 'GET') {
    json(response, 200, await listRecordings());
  } else if (chunk && request.method === 'POST') {
    json(response, 200, await storeChunk(id, Number(chunk[2]), request));
  } else if (stop && request.method === 'POST') {
    const body = JSON.parse((await readBody(request)).toString('utf8') || '{}');
    const result = await finalize(id, body);
    json(response, result.status, result.body);
  } else if (file && request.method === 'GET') {
    const path = join(RECORDINGS, id, 'recording.webm');
    if (!existsSync(path)) json(response, 404, { error: `recording ${id} is not finalized` });
    else serveFile(request, response, path, CORS);
  } else if (one && request.method === 'DELETE') {
    await rm(join(RECORDINGS, id), { recursive: true, force: true });
    json(response, 200, { deleted: id });
  } else {
    json(response, 404, { error: `no route ${request.method} ${url.pathname}` });
  }
}

function serve(directory, port, label, withApi) {
  const base = resolve(directory);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (withApi && url.pathname.startsWith('/api/')) {
      api(request, response, url).catch((error) => {
        console.error(`${request.method} ${url.pathname}:`, error);
        json(response, 500, { error: String(error) });
      });
      return;
    }
    let path = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!path.startsWith(base)) {
      response.writeHead(403).end();
      return;
    }
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${url.pathname}`);
      return;
    }
    serveFile(request, response, path);
  });
  server.listen(port, '127.0.0.1', () => console.log(`${label}: http://localhost:${port}/ from ${base}`));
  return server;
}

serve('dist/demo', 5173, 'demo and recordings API', true);
serve('dist/pack', 8765, 'pack', false);
