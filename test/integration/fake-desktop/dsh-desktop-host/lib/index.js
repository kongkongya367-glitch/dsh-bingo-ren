// Fake desktop host: mounts the real Bingo runtime with a mock Cordis ctx and
// a real HTTP server, using deps.shellPid/appExe overrides so the real helper
// kills the fake shell and launches a harmless process.
// ESM because the repository package.json declares "type": "module"; the path
// must end with dsh-desktop-host/lib/index.js for the plugin's desktop detector.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

Object.defineProperty(process.versions, 'electron', { value: '35.0.0', configurable: true });
const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, '..', '..');
const dir = process.env.BINGO_FAKE_DIR || sourceDir;
const root = path.resolve(sourceDir, '..', '..', '..');
const trace = (m) => { try { fs.appendFileSync(path.join(dir, 'trace.txt'), m + '\n'); } catch {} };

trace('start');
const mod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href);
trace('imported');

const exact = new Map();
const prefixes = new Map();
const listeners = new Map();
const webServer = {
  port: 0,
  register(route) {
    const table = route.kind === 'exact' ? exact : prefixes;
    if (table.has(route.path)) throw new Error('duplicate ' + route.path);
    table.set(route.path, route);
    return () => table.delete(route.path);
  },
  tapIndex() { return () => {}; },
  collectIndexInjections() {
    const table = [];
    for (const cb of listeners.get('webserver/index-inject') || []) cb(table);
    return table;
  },
  getOrigin() { return 'http://127.0.0.1:' + webServer.port; },
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url || '/', 'http://x').pathname;
    let route = exact.get(pathname);
    if (!route) for (const [prefix, candidate] of prefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + '/')) {
        if (!route || prefix.length > route.path.length) route = candidate;
      }
    }
    if (!route) { res.writeHead(404); res.end(); return; }
    await route.handler(req, res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
webServer.port = server.address().port;
trace('listening ' + webServer.port);
const ctx = {
  webServer,
  on(name, cb) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(cb);
    return () => {};
  },
  inject(_names, cb) { cb(ctx); },
  effect(fn) { try { fn(); } catch {} return () => {}; },
  get(name) { return name === 'webServer' ? webServer : undefined; },
  logger: Object.assign(() => {}, { info() {}, warn() {}, error() {}, debug() {} }),
};
mod.createRuntime(ctx, { pollMs: 60000, debug: true }, {
  shellPid: Number(process.env.BINGO_FAKE_SHELL_PID),
  hostPid: process.pid,
  appExe: process.execPath,
  appDir: path.dirname(process.execPath),
  helperPath: path.join(root, 'lib', 'restart-helper.cjs'),
});
trace('runtime-created');
fs.writeFileSync(path.join(dir, 'port.txt'), String(webServer.port));
setInterval(() => {}, 1000);