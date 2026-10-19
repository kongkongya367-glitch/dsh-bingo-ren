import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { createRescue } from '../lib/rescue.js';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const helper = require('../lib/restart-helper.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_ROOT = path.join(ROOT, '.tmp');
const HELPER_PATH = path.join(ROOT, 'lib', 'restart-helper.cjs');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');
const FAKE_PROCESS = path.join(FIXTURES, 'fake-process.cjs');
const MARKER_LAUNCH = path.join(FIXTURES, 'marker-launch.cjs');

const FAST_TIMINGS = {
  delayMs: 80,
  exitWaitMs: 5000,
  forceWaitMs: 300,
  pollMs: 40,
  portProbeMs: 120,
  startupPollMs: 1500,
  startupSettleMs: 250,
  retryDelayMs: 150,
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeDir(label) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, 'helper-' + label + '-'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('timed out waiting for ' + (label || 'condition'));
}

function readLog(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

async function readJsonWithWait(filePath, timeoutMs) {
  let parsed = null;
  await waitFor(() => {
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return true;
    } catch {
      return false;
    }
  }, timeoutMs, 'json file ' + filePath);
  return parsed;
}

function waitExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (error) {
        /* ignore */
      }
      reject(new Error('process did not exit within ' + timeoutMs + 'ms'));
    }, timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function stop(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch (error) {
    /* already gone */
  }
}

async function startFakeProcess(dir, name) {
  const pidFile = path.join(dir, name + '.pid');
  const child = spawn(process.execPath, [FAKE_PROCESS, pidFile], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await waitFor(() => fs.existsSync(pidFile), 5000, name + ' pid file');
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  assert.ok(Number.isInteger(pid) && pid > 0, 'fake ' + name + ' pid');
  return { child, pid };
}

async function createDeadPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true });
  await waitExit(child, 5000);
  return child.pid;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startListener() {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    port: server.address().port,
    close() {
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function baseConfig(dir, overrides) {
  const markerPath = path.join(dir, 'marker.json');
  const cfg = {
    shellPid: 1,
    hostPid: 2,
    appExe: 'C:/fake/DeepSeek Harness.exe',
    appDir: FIXTURES,
    port: null,
    logPath: path.join(dir, 'restart.log'),
    trigger: 'button',
    delayMs: 80,
    createdAt: '2026-01-01T00:00:00.000Z',
    testLaunch: { file: process.execPath, args: [MARKER_LAUNCH, markerPath] },
    testTimings: { ...FAST_TIMINGS },
  };
  return Object.assign(cfg, overrides || {});
}

function runHelper(cfg, extraEnv) {
  const token = Buffer.from(JSON.stringify(cfg), 'utf8').toString('base64url');
  const child = spawn(process.execPath, [HELPER_PATH, token], {
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, extraEnv || {}),
  });
  return { child, done: waitExit(child, 30000) };
}

function registerCleanup(t, dir, cleanup) {
  t.after(() => {
    if (cleanup) cleanup();
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      /* ignore */
    }
  });
}

/* ------------------------------------------------------------------ */
/* Unit tests                                                          */
/* ------------------------------------------------------------------ */

test('parseConfig decodes the base64url payload and validates PIDs', () => {
  const valid = {
    shellPid: 1234,
    hostPid: 5678,
    appExe: 'C:/app.exe',
    appDir: 'C:/app',
    logPath: 'C:/log/restart.log',
    port: 4321,
    trigger: 'button',
  };
  const token = Buffer.from(JSON.stringify(valid), 'utf8').toString('base64url');
  assert.deepEqual(helper.parseConfig(token), valid);

  assert.throws(() => helper.parseConfig(''), /missing config payload/);
  assert.throws(() => helper.parseConfig(undefined), /missing config payload/);
  assert.throws(() => helper.parseConfig('***'), /invalid config JSON/);
  assert.throws(
    () => helper.parseConfig(Buffer.from(JSON.stringify(null)).toString('base64url')),
    /config must be an object/,
  );
  assert.throws(
    () => helper.parseConfig(Buffer.from(JSON.stringify(Object.assign({}, valid, { shellPid: 0 }))).toString('base64url')),
    /shellPid/,
  );
  assert.throws(
    () => helper.parseConfig(Buffer.from(JSON.stringify(Object.assign({}, valid, { hostPid: -1 }))).toString('base64url')),
    /hostPid/,
  );
  assert.throws(
    () => helper.parseConfig(Buffer.from(JSON.stringify(Object.assign({}, valid, { appExe: '' }))).toString('base64url')),
    /appExe/,
  );
  assert.throws(
    () => helper.parseConfig(Buffer.from(JSON.stringify(Object.assign({}, valid, { logPath: '' }))).toString('base64url')),
    /logPath/,
  );
});

test('pidAlive reports live/dead processes and rejects invalid PIDs', async () => {
  assert.equal(helper.pidAlive(process.pid), true);
  const dead = await createDeadPid();
  assert.equal(helper.pidAlive(dead), false);
  assert.equal(helper.pidAlive(0), false);
  assert.equal(helper.pidAlive(-5), false);
  assert.equal(helper.pidAlive(undefined), false);
});

test('probePort distinguishes listening and released ports', async () => {
  const listener = await startListener();
  assert.equal(await helper.probePort(listener.port, 300), true);
  await listener.close();
  assert.equal(await helper.probePort(listener.port, 300), false);
  assert.equal(await helper.probePort(null, 100), false);
  assert.equal(await helper.probePort(-1, 100), false);
  assert.equal(await helper.probePort(999999, 100), false);
});

test('cleanEnv strips Electron/DSH leakage but keeps DSH_HOME and DSH_PROFILE', () => {
  const env = helper.cleanEnv({
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    NODE_OPTIONS: '--inspect',
    DSH_DESKTOP_NODE_EXECUTABLE: 'C:/node.exe',
    DSH_SHELL: '1',
    DSH_SESSION_ID: 'sid',
    DSH_WEB_URL: 'http://127.0.0.1:1',
    DSH_HOME: 'C:/dsh',
    DSH_PROFILE: 'desktop',
    PATH: 'C:/bin',
    UNRELATED: 'kept',
  });
  for (const key of helper.CLEAN_ENV_KEYS) assert.equal(Object.hasOwn(env, key), false, key);
  assert.equal(env.DSH_HOME, 'C:/dsh');
  assert.equal(env.DSH_PROFILE, 'desktop');
  assert.equal(env.PATH, 'C:/bin');
  assert.equal(env.UNRELATED, 'kept');
});

test('rotateLog moves an oversized log aside and leaves small logs alone', () => {
  const dir = makeDir('rotate');
  try {
    const logPath = path.join(dir, 'restart.log');
    fs.writeFileSync(logPath, 'x'.repeat(300 * 1024), 'utf8');
    assert.equal(helper.rotateLog(logPath), true);
    assert.equal(fs.existsSync(logPath), false);
    assert.equal(fs.statSync(logPath + '.1').size, 300 * 1024);

    fs.writeFileSync(logPath, 'small', 'utf8');
    assert.equal(helper.rotateLog(logPath), false);
    assert.equal(fs.readFileSync(logPath, 'utf8'), 'small');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveTimings merges defaults, testTimings and cfg.delayMs', () => {
  const defaults = helper.resolveTimings({});
  assert.equal(defaults.exitWaitMs, 15000);
  assert.equal(defaults.forceWaitMs, 3000);
  assert.equal(defaults.pollMs, 250);
  assert.equal(defaults.startupPollMs, 20000);

  const overridden = helper.resolveTimings({
    delayMs: 12,
    testTimings: { exitWaitMs: 100, forceWaitMs: 50, startupSettleMs: 5 },
  });
  assert.equal(overridden.delayMs, 12);
  assert.equal(overridden.exitWaitMs, 100);
  assert.equal(overridden.forceWaitMs, 50);
  assert.equal(overridden.startupSettleMs, 5);
  assert.equal(overridden.startupPollMs, 20000);
});

test('launchTarget prefers the test hook and otherwise the app executable', () => {
  assert.deepEqual(helper.launchTarget({ appExe: 'C:/app.exe', appDir: 'C:/' }), {
    file: 'C:/app.exe',
    args: [],
    test: false,
  });
  assert.deepEqual(
    helper.launchTarget({ appExe: 'C:/app.exe', testLaunch: { file: 'node', args: ['a', 1] } }),
    { file: 'node', args: ['a', '1'], test: true },
  );
});

test('taskkillPath resolves an absolute executable when available', () => {
  const resolved = helper.taskkillPath();
  assert.ok(typeof resolved === 'string' && resolved.length > 0);
});

test('helper exits 1 when launched without a config payload', async () => {
  const child = spawn(process.execPath, [HELPER_PATH], { stdio: 'ignore', windowsHide: true });
  const result = await waitExit(child, 10000);
  assert.equal(result.code, 1);
});

/* ------------------------------------------------------------------ */
/* Integration: real fake shell/host processes                         */
/* ------------------------------------------------------------------ */

test('helper applies minimal boot only after the old fake shell has exited',async(t)=>{
  const dir=makeDir('minimal-boot');const profile=path.join(dir,'profile');const stateDir=path.join(dir,'state');fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify({dependencies:{community:'1','dsh-bingo-ren':'1'},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','community','dsh-bingo-ren']}}}));
  const rescue=createRescue({profileDir:profile,stateDir});const task=rescue.prepare('enter');
  const shell=await startFakeProcess(dir,'shell');const deadHost=await createDeadPid();let replacement;
  t.after(()=>{stop(shell.pid);stop(replacement);fs.rmSync(dir,{recursive:true,force:true});});
  const cfg=baseConfig(dir,{shellPid:shell.pid,hostPid:deadHost,recoveryTask:task});
  const run=runHelper(cfg);const result=await run.done;assert.equal(result.code,0,readLog(cfg.logPath));
  const marker=await readJsonWithWait(cfg.testLaunch.args[1],5000);replacement=marker.pid;
  assert.equal(helper.pidAlive(shell.pid),false);assert.equal(rescue.summary().phase,'active');
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'package.json'))).dsh.profile.bundles.includes('community'),false);
  assert.match(readLog(cfg.logPath),/recovery applied enter/);
});

test('helper: kill shell -> wait -> detached launch with a cleaned env', async (t) => {
  const dir = makeDir('happy');
  const cleanupPids = [];
  t.after(() => {
    for (const pid of cleanupPids) stop(pid);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const shell = await startFakeProcess(dir, 'shell');
  const deadHost = await createDeadPid();
  const port = await freePort();
  const cfg = baseConfig(dir, { shellPid: shell.pid, hostPid: deadHost, port });

  const run = runHelper(cfg, {
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    NODE_OPTIONS: '--trace-warnings',
    DSH_DESKTOP_NODE_EXECUTABLE: 'C:/node.exe',
    DSH_SHELL: '1',
    DSH_SESSION_ID: 'session-id',
    DSH_WEB_URL: 'http://127.0.0.1:1',
    DSH_HOME: dir,
    DSH_PROFILE: 'bingo-test',
  });
  const result = await run.done;
  assert.equal(result.code, 0, 'helper exit code; log: ' + readLog(cfg.logPath));

  const marker = await readJsonWithWait(cfg.testLaunch.args[1], 5000);
  cleanupPids.push(marker.pid);
  assert.ok(Number.isInteger(marker.pid) && marker.pid > 0);
  assert.equal(marker.electronRunAsNode, null);
  assert.equal(marker.nodeOptions, null);
  assert.equal(marker.dshDesktopNodeExecutable, null);
  assert.equal(marker.dshShell, null);
  assert.equal(marker.dshSessionId, null);
  assert.equal(marker.dshWebUrl, null);
  assert.equal(marker.dshHome, dir);
  assert.equal(marker.dshProfile, 'bingo-test');

  await waitFor(() => !helper.pidAlive(shell.pid), 5000, 'shell termination');
  const log = readLog(cfg.logPath);
  assert.ok(log.includes('] start '), 'start stage');
  assert.ok(log.includes('terminating shell pid ' + shell.pid), 'kill stage');
  assert.ok(log.includes('old shell/host gone and port released'), 'wait stage');
  assert.ok(log.includes('replacement pid'), 'launch stage');
  assert.ok(log.includes('done ok'), 'done stage');
});

test('helper: waits for the old port to be released before launching', async (t) => {
  const dir = makeDir('port');
  const cleanupPids = [];
  const listener = await startListener();
  t.after(async () => {
    for (const pid of cleanupPids) stop(pid);
    await listener.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const shell = await startFakeProcess(dir, 'shell');
  const deadHost = await createDeadPid();
  const cfg = baseConfig(dir, { shellPid: shell.pid, hostPid: deadHost, port: listener.port });
  const run = runHelper(cfg);

  await waitFor(() => !helper.pidAlive(shell.pid), 5000, 'shell termination');
  await sleep(400);
  assert.equal(fs.existsSync(cfg.testLaunch.args[1]), false, 'replacement must not start while the port is busy');
  const releasedAt = Date.now();
  await listener.close();

  const result = await run.done;
  assert.equal(result.code, 0, 'helper exit code; log: ' + readLog(cfg.logPath));
  const marker = await readJsonWithWait(cfg.testLaunch.args[1], 5000);
  cleanupPids.push(marker.pid);
  assert.ok(marker.ts >= releasedAt - 20, 'launch happened after the port was released');
});

test('helper: timeout path force-kills shell/host numerically and still launches', async (t) => {
  const dir = makeDir('timeout');
  const cleanupPids = [];
  const listener = await startListener();
  t.after(async () => {
    for (const pid of cleanupPids) stop(pid);
    await listener.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const shell = await startFakeProcess(dir, 'shell');
  const host = await startFakeProcess(dir, 'host');
  const cfg = baseConfig(dir, {
    shellPid: shell.pid,
    hostPid: host.pid,
    port: listener.port,
    testTimings: Object.assign({}, FAST_TIMINGS, { exitWaitMs: 400, forceWaitMs: 200 }),
  });
  const run = runHelper(cfg);
  // The listener is deliberately never released: the wait must time out.
  const result = await run.done;
  assert.equal(result.code, 0, 'helper exit code; log: ' + readLog(cfg.logPath));

  const log = readLog(cfg.logPath);
  assert.ok(log.includes('] timeout '), 'timeout stage');
  assert.ok(log.includes('taskkill /F /PID ' + host.pid), 'numeric taskkill for the host');
  assert.ok(log.includes('done ok'), 'launch after force kill');
  assert.equal(helper.pidAlive(host.pid), false, 'host was force-killed');
  assert.equal(log.includes('/T'), false, 'never a process tree');

  const marker = await readJsonWithWait(cfg.testLaunch.args[1], 5000);
  cleanupPids.push(marker.pid);
});

test('helper: already-dead PIDs are ESRCH-success, not a failure', async (t) => {
  const dir = makeDir('esrch');
  const cleanupPids = [];
  const dead = await createDeadPid();
  t.after(() => {
    for (const pid of cleanupPids) stop(pid);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const cfg = baseConfig(dir, { shellPid: dead, hostPid: dead, port: await freePort() });
  const run = runHelper(cfg);
  const result = await run.done;
  assert.equal(result.code, 0, 'helper exit code; log: ' + readLog(cfg.logPath));
  const log = readLog(cfg.logPath);
  assert.ok(log.includes('already gone'), 'ESRCH logged as success');
  assert.ok(log.includes('done ok'), 'replacement launched');
  const marker = await readJsonWithWait(cfg.testLaunch.args[1], 5000);
  cleanupPids.push(marker.pid);
});

test('helper: a failed launch is retried once and exits 1 when both fail', async (t) => {
  const dir = makeDir('launchfail');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dead = await createDeadPid();
  const cfg = baseConfig(dir, {
    shellPid: dead,
    hostPid: dead,
    port: await freePort(),
    testLaunch: { file: path.join(dir, 'does-not-exist.exe'), args: [] },
  });
  const run = runHelper(cfg);
  const result = await run.done;
  assert.equal(result.code, 1);
  const log = readLog(cfg.logPath);
  assert.ok(log.includes("] retry launch attempt 1 failed"), 'first attempt retried');
  assert.ok(log.includes("] retry launch attempt 2 failed") || log.includes('replacement could not be started'), 'second failure recorded');
  assert.equal(log.includes('done ok'), false);
});

test('helper: rotates an oversized log before appending', async (t) => {
  const dir = makeDir('rotate-run');
  const cleanupPids = [];
  t.after(() => {
    for (const pid of cleanupPids) stop(pid);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const dead = await createDeadPid();
  const cfg = baseConfig(dir, { shellPid: dead, hostPid: dead, port: await freePort() });
  fs.writeFileSync(cfg.logPath, 'OLD'.repeat(100 * 1024), 'utf8');
  const run = runHelper(cfg);
  const result = await run.done;
  assert.equal(result.code, 0);
  assert.equal(fs.existsSync(cfg.logPath + '.1'), true);
  assert.ok(fs.statSync(cfg.logPath + '.1').size > 256 * 1024);
  assert.ok(readLog(cfg.logPath).includes('] start '));
  const marker = await readJsonWithWait(cfg.testLaunch.args[1], 5000);
  cleanupPids.push(marker.pid);
});
