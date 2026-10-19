/**
 * Static file server for the Bingo preview.
 * Serves the repository root so preview/index.html can reach ../client/.
 * No writes, no plugin APIs, no real profile.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BINGO_PREVIEW_PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/preview/index.html';
  const target = path.resolve(ROOT, '.' + pathname);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(target, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found: ' + pathname);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Bingo preview: http://127.0.0.1:' + PORT + '/preview/index.html?dev=1');
});
