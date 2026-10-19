#!/usr/bin/env node
// End-to-end: real Bingo runtime route -> real detached helper -> kill fake
// Electron shell + fake host -> detached launch. No real Electron is touched.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const reuse = process.env.BINGO_FAKE_DIR;
const dir = reuse || mkdtempSync(join(tmpdir(), 'dsh-bingo-fake-'));
const home = join(dir, 'bingo-home');
mkdirSync(home, { recursive: true });
for (const f of ['port.txt', 'shell.pid', 'host.pid', 'fatal.txt', 'restart.log']) { try { rmSync(join(dir, f)); } catch {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shell = spawn(process.execPath, [join(here, 'shell.cjs')], {
  cwd: here,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, DSH_BINGO_HOME: home, DSH_PROFILE_DIR: join(dir, 'profile'), BINGO_FAKE_DIR: dir },
});
shell.unref();

let port = null;
let fatal = null;
const deadline = Date.now() + 8000;
while (Date.now() < deadline) {
  await sleep(150);
  try { port = Number(readFileSync(join(dir, 'port.txt'), 'utf8')); if (Number.isInteger(port) && port > 0) break; } catch {}
  try { fatal = readFileSync(join(dir, 'fatal.txt'), 'utf8'); if (fatal) break; } catch {}
}
assert.ok(!fatal, 'fake host failed: ' + fatal);
assert.ok(port, 'fake host never wrote port.txt');
const shellPid = Number(readFileSync(join(dir, 'shell.pid'), 'utf8'));
const hostPid = Number(readFileSync(join(dir, 'host.pid'), 'utf8'));

async function request(method, path, body) {
  const res = await fetch('http://127.0.0.1:' + port + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

const status = await request('GET', '/bingo/status');
assert.equal(status.status, 200, status.text);
const parsed = JSON.parse(status.text);
assert.equal(parsed.desktop, true, JSON.stringify(parsed));
assert.equal(parsed.canRestart, true, JSON.stringify(parsed));
console.log('status ok: desktop=true canRestart=true');

let restartError = null;
try { await request('POST', '/bingo/restart', { trigger: 'button' }); } catch (e) { restartError = String(e && e.message || e); }
console.log('restart request returned/cut:', restartError || 'response received');

let log = '';
const logDeadline = Date.now() + 20000;
while (Date.now() < logDeadline) {
  await sleep(250);
  try { log = readFileSync(join(home, 'restart.log'), 'utf8'); } catch {}
  if (log.includes('replacement started') || log.includes('helper done')) break;
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
const shellAlive = alive(shellPid);
const hostAlive = alive(hostPid);
console.log('--- restart.log ---\n' + log);
console.log('shellAlive=' + shellAlive + ' hostAlive=' + hostAlive);
try { process.kill(shellPid, 'SIGKILL'); } catch {}

assert.ok(log.includes('start helper'), 'helper never started');
assert.match(log, /kill (terminating|signalled)|ESRCH/);
assert.match(log, /launch replacement pid \d+/);
assert.equal(shellAlive, false, 'fake shell still alive');
assert.equal(hostAlive, false, 'fake host still alive');
// The launched process is a bare node.exe for safety, so it exits immediately and the helper
// reports a launch failure after its retry. The chain under test is route -> helper -> kill ->
// wait for port -> detached launch; the release path itself is covered by helper unit tests.
console.log('PASS desktop restart chain end-to-end (fake shell + fake host + real helper)');
if (!reuse) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
process.exit(0);