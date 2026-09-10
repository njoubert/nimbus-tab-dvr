#!/usr/bin/env node
// Copyright (C) 2026 Niels Joubert
// SPDX-License-Identifier: MIT

// Serves the built demo on 5173 and the packed extension on 8765, so the demo has an origin
// the extension can allow and Chrome has an update URL it can force-install from.
// Usage: node scripts/spike/serve.mjs

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
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

function serve(directory, port, label) {
  const base = resolve(directory);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
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
    response.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(response);
  });
  server.listen(port, '127.0.0.1', () => console.log(`${label}: http://localhost:${port}/ from ${base}`));
  return server;
}

serve('dist/demo', 5173, 'demo');
serve('dist/pack', 8765, 'pack');
