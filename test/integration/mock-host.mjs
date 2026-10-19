#!/usr/bin/env node
/**
 * Lead-owned integration harness for dsh-bingo-ren.
 * Mounts the real host plugin on a bare node:http server using a mock
 * Cordis webServer/ctx, then exercises routes, fence, injection and detection.
 *
 * Run: node test/integration/mock-host.mjs
 * No real Electron, no real restart, writes only under the OS temp dir.
 */
import http from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'dsh-bingo-it-'));
const home = join(tmp, 'bingo-home');
const profile = join(tmp, 'profile');
mkdirSync(home, { recursive: true });
mkdirSync(profile, { recursive: true });
process.env.DSH_BINGO_HOME = home;
process.env.DSH_PROFILE_DIR = profile;
process.env.DSH_HOME = join(tmp, 'dsh-home');
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-test',
  dependencies: { 'dsh-existing': '1.0.0' },
  dsh: { profile: { bundles: ['dsh-existing'] } },
}, null, 2));

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.log('FAIL', name, '-', e && e.message ? e.message : e);
  }
}

function rawRequest(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const listeners = new Map();
const effects = [];
const exactRoutes = new Map();
const prefixRoutes = new Map();
const taps = [];
const logger = Object.assign((...a) => console.log('[plugin]', ...a), {
  info: (...a) => console.log('[plugin:info]', ...a),
  warn: (...a) => console.log('[plugin:warn]', ...a),
  error: (...a) => console.log('[plugin:error]', ...a),
  debug: () => {},
});
const webServer = {
  port: undefined,
  register(route) {
    const table = route.kind === 'exact' ? exactRoutes : route.kind === 'prefix' ? prefixRoutes : null;
    if (!table) throw new Error('unknown route kind ' + route.kind);
    if (table.has(route.path)) throw new Error('duplicate route ' + route.path);
    table.set(route.path, route);
    return () => table.delete(route.path);
  },
  tapIndex(fn) { taps.push(fn); return () => { const i = taps.indexOf(fn); if (i >= 0) taps.splice(i, 1); }; },
  collectIndexInjections() {
    const table = [];
    for (const cb of listeners.get('webserver/index-inject') ?? []) cb(table);
    return table;
  },
  getOrigin() { return 'http://127.0.0.1:' + String(webServer.port); },
};
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let route = exactRoutes.get(path);
    if (!route) {
      for (const [prefix, candidate] of prefixRoutes) {
        if (path !== prefix && !path.startsWith(prefix + '/')) continue;
        if (!route || prefix.length > route.path.length) route = candidate;
      }
    }
    if (!route) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    await route.handler(req, res);
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end(String((e && e.stack) || e));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
webServer.port = server.address().port;
const port = webServer.port;
const ctx = {
  webServer,
  connection: undefined,
  on(name, cb) {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(cb);
    return () => { const arr = listeners.get(name); const i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1); };
  },
  inject(_names, cb) { cb(ctx); return ctx; },
  effect(fn) { effects.push(fn); return () => {}; },
  get(name) { return name === 'webServer' ? webServer : undefined; },
  logger,
};
process.on('exit', () => { try { server.close(); } catch {} try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

let mod;
try {
  mod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href + '?t=' + Date.now());
} catch (e) {
  console.error('CANNOT IMPORT lib/index.js:', e.message);
  process.exit(2);
}
const plugin = mod.default && mod.default.apply ? mod.default : mod;
assert.equal(typeof plugin.apply, 'function', 'plugin must export apply');
if (typeof plugin.name === 'string') assert.equal(plugin.name, 'dsh-bingo-ren');
await plugin.apply(ctx, { pollMs: 1500, debug: true });

const goodHeaders = { host: '127.0.0.1:' + String(port) };

await test('injection row is registered synchronously and loads /bingo/client.js', () => {
  const table = webServer.collectIndexInjections();
  assert.ok(Array.isArray(table) && table.length > 0, 'no injection rows');
  const row = table.find((r) => r && r.kind === 'script' && String(r.text).includes('/bingo/client.js'));
  assert.ok(row, 'no script row with /bingo/client.js: ' + JSON.stringify(table));
  assert.equal(row.placement, 'body');
  assert.match(String(row.text), /onerror/);
  const again = webServer.collectIndexInjections();
  const count = again.filter((r) => r && r.kind === 'script' && String(r.text).includes('/bingo/client.js')).length;
  assert.equal(count, 1, 'row must be deduplicated');
});
await test('web tapIndex fallback injects client script', () => {
  const html = taps.reduce((acc, fn) => fn(acc), '<html><body>hi</body></html>');
  assert.match(html, /\/bingo\/client\.js/);
});

let status;
await test('GET /bingo/status returns 200 JSON with required fields', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: goodHeaders });
  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type']), /application\/json/);
  assert.equal(res.headers['cache-control'], 'no-store');
  status = JSON.parse(res.body);
  assert.equal(status.ok, true);
  assert.equal(typeof status.version, 'string');
  assert.equal(status.desktop, false, 'harness is not desktop host');
  assert.equal(status.canRestart, false);
  assert.equal(typeof status.pollMs, 'number');
  assert.ok('pending' in status);
});
await test('non-loopback Host is rejected', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: { host: 'evil.example' } });
  assert.equal(res.status, 403);
});
await test('cross-origin Origin is rejected', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: { ...goodHeaders, origin: 'http://evil.example' } });
  assert.equal(res.status, 403);
});
await test('cross-site fetch metadata is rejected', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: { ...goodHeaders, 'sec-fetch-site': 'cross-site' } });
  assert.equal(res.status, 403);
});
await test('same-origin Origin is accepted', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: { ...goodHeaders, origin: 'http://127.0.0.1:' + String(port) } });
  assert.equal(res.status, 200);
});
await test('POST /bingo/restart is refused on non-desktop host', async () => {
  const res = await rawRequest(port, { method: 'POST', path: '/bingo/restart', headers: { ...goodHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ trigger: 'button' }) });
  assert.equal(res.status, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'unsupported');
});
await test('unknown /bingo/* is 404', async () => {
  const res = await rawRequest(port, { path: '/bingo/nope', headers: goodHeaders });
  assert.equal(res.status, 404);
});

await new Promise((r) => setTimeout(r, 500));
writeFileSync(join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-test',
  dependencies: { 'dsh-existing': '1.0.0', 'dsh-newcomer': '2.3.4' },
  dsh: { profile: { bundles: ['dsh-existing', 'dsh-newcomer'] } },
}, null, 2));
await new Promise((r) => setTimeout(r, 4200));
let pendingSig = null;
await test('new dependency is detected as pending', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: goodHeaders });
  const body = JSON.parse(res.body);
  assert.ok(body.pending, 'pending is null: ' + res.body);
  assert.ok(Array.isArray(body.pending.packages));
  assert.ok(body.pending.packages.some((p) => p.name === 'dsh-newcomer'), JSON.stringify(body.pending));
  assert.equal(typeof body.pending.signature, 'string');
  pendingSig = body.pending.signature;
});
await test('POST /bingo/dismiss acks pending', async () => {
  const res = await rawRequest(port, { method: 'POST', path: '/bingo/dismiss', headers: { ...goodHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ signature: pendingSig }) });
  assert.equal(res.status, 200);
});
await test('acked pending is hidden', async () => {
  const res = await rawRequest(port, { path: '/bingo/status', headers: goodHeaders });
  const body = JSON.parse(res.body);
  assert.equal(body.pending, null, res.body);
});

await test('activity HTTP endpoint includes durable changes and honest unknown acceptance', async () => {
  const res = await rawRequest(port, { path: '/bingo/activity', headers: goodHeaders });
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.history.some(e => e.name === 'dsh-newcomer' && e.kind === 'added'));
  assert.ok(data.acceptance.every(e => e.state === 'unknown'));
});
let trialId;
await test('trial can be marked over HTTP and persists in activity', async () => {
  const res = await rawRequest(port, { method: 'POST', path: '/bingo/trials', headers: { ...goodHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', name: 'dsh-newcomer', version: '2.3.4' }) });
  assert.equal(res.status, 200);
  const activity = JSON.parse((await rawRequest(port, { path: '/bingo/activity', headers: goodHeaders })).body);
  trialId = activity.trials[0].id;
  assert.equal(activity.trials[0].reviewDue, false);
  assert.equal(activity.canRemove, false);
});
await test('keeping a trial over HTTP ends the reminder', async () => {
  const res = await rawRequest(port, { method: 'POST', path: '/bingo/trials', headers: { ...goodHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'keep', name: 'dsh-newcomer', id: trialId }) });
  assert.equal(res.status, 200);
  const activity = JSON.parse((await rawRequest(port, { path: '/bingo/activity', headers: goodHeaders })).body);
  assert.equal(activity.trials.length, 0);
});

const clientFile = join(root, 'client', 'bingo-client.js');
if (existsSync(clientFile)) {
  await test('GET /bingo/client.js serves javascript', async () => {
    const res = await rawRequest(port, { path: '/bingo/client.js', headers: goodHeaders });
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /javascript/);
    assert.match(res.body, /__DSH_BINGO_LOADED__/);
  });
} else {
  console.log('SKIP GET /bingo/client.js (client/bingo-client.js not yet present)');
}

await new Promise((resolve) => server.close(resolve));
try { rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log('\n' + '='.repeat(50));
console.log(String(passed) + ' passed, ' + String(failed) + ' failed');
process.exit(failed ? 1 : 0);
