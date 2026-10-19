#!/usr/bin/env node
/**
 * dsh-bingo-ren — detached restart helper.
 *
 * Runs as Electron-in-Node-mode (ELECTRON_RUN_AS_NODE=1) OUTSIDE the app
 * process tree, so it survives the Electron shell being killed. It is the only
 * component allowed to perform the actual restart.
 *
 * Flow (SPEC §5.5):
 *   parse argv[2] base64url JSON -> append-only log (rotate >256KB) ->
 *   sleep(delayMs) -> kill the Electron shell PID by NUMBER -> wait (<=15s)
 *   for shell+host to vanish and the port to refuse connections ->
 *   on timeout force-kill both numerically (taskkill /F /PID, NEVER /T) ->
 *   relaunch the exe detached with a cleaned env -> confirm the replacement
 *   is alive (old random port is usually NOT reused) -> exit 0.
 *
 * Safety:
 *  - only the two numeric PIDs from the config are ever killed;
 *  - never kill by image name and never a process tree (/T would kill this
 *    helper too);
 *  - any failure is logged; a failed launch after the kill is retried once.
 *
 * Test hooks (never passed in production):
 *  - cfg.testLaunch { file, args }  replaces the app executable
 *  - cfg.testTimings { ... }        shortens waits for fast integration tests
 * The module also exports its internals; main() only runs when executed
 * directly, so tests can require() it without spawning anything.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const LOG_MAX_BYTES = 256 * 1024;
const TAG = 'dsh-bingo-ren';

const DEFAULTS = Object.freeze({
  delayMs: 650,
  exitWaitMs: 15000,
  forceWaitMs: 3000,
  pollMs: 250,
  portProbeMs: 500,
  startupPollMs: 20000,
  startupSettleMs: 2500,
  retryDelayMs: 1000,
  logTailBytes: 96 * 1024,
});

/** Environment variables that must not leak into the relaunched app. */
const CLEAN_ENV_KEYS = Object.freeze([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'DSH_DESKTOP_NODE_EXECUTABLE',
  'DSH_SHELL',
  'DSH_SESSION_ID',
  'DSH_WEB_URL',
]);

let activeLogger = null;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  const delay = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/**
 * Decode and validate the base64url JSON payload from argv[2].
 * Throws on anything that could make the helper act on the wrong process.
 */
function parseConfig(token) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('missing config payload');
  let json;
  try {
    json = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('invalid base64url config payload');
  }
  let cfg;
  try {
    cfg = JSON.parse(json);
  } catch {
    throw new Error('invalid config JSON');
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('config must be an object');
  if (!Number.isInteger(cfg.shellPid) || cfg.shellPid <= 0) throw new Error('shellPid must be a positive integer');
  if (!Number.isInteger(cfg.hostPid) || cfg.hostPid <= 0) throw new Error('hostPid must be a positive integer');
  if (typeof cfg.appExe !== 'string' || cfg.appExe.length === 0) throw new Error('appExe must be a non-empty string');
  if (typeof cfg.appDir !== 'string' || cfg.appDir.length === 0) throw new Error('appDir must be a non-empty string');
  if (typeof cfg.logPath !== 'string' || cfg.logPath.length === 0) throw new Error('logPath must be a non-empty string');
  return cfg;
}

/** Resolve the timing table, allowing the test-only override. */
function resolveTimings(cfg) {
  const overrides = cfg && cfg.testTimings && typeof cfg.testTimings === 'object' ? cfg.testTimings : {};
  const timings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = Number(overrides[key]);
    if (Number.isFinite(value) && value >= 0) timings[key] = value;
  }
  if (Number.isFinite(Number(cfg && cfg.delayMs)) && Number(cfg.delayMs) >= 0) {
    timings.delayMs = Number(cfg.delayMs);
  }
  return timings;
}

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

/**
 * Rotate the log when it exceeds 256KB: existing .1 is replaced, the current
 * log becomes .1, and a fresh log is opened by the caller.
 * @returns {boolean} whether a rotation happened
 */
function rotateLog(logPath) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return false;
  }
  if (size <= LOG_MAX_BYTES) return false;
  const backup = logPath + '.1';
  try {
    fs.rmSync(backup, { force: true });
  } catch {
    /* best effort */
  }
  try {
    fs.renameSync(logPath, backup);
    return true;
  } catch {
    try {
      fs.truncateSync(logPath, 0);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Append-only logger with the SPEC line format: `[ISO] stage message`.
 * Never throws — a broken log must not stop a restart.
 */
function createLogger(logPath) {
  let fd = null;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch {
    /* ignore */
  }
  try {
    rotateLog(logPath);
    fd = fs.openSync(logPath, 'a');
  } catch {
    fd = null;
  }
  const write = (stage, message) => {
    const line = '[' + nowIso() + '] ' + stage + (message ? ' ' + message : '') + '\n';
    try {
      if (fd !== null) fs.writeSync(fd, line);
    } catch {
      /* ignore */
    }
  };
  const close = () => {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
      fd = null;
    }
  };
  return { write, close, path: logPath };
}

/* ------------------------------------------------------------------ */
/* Process primitives                                                  */
/* ------------------------------------------------------------------ */

/** `process.kill(pid, 0)`; EPERM means "alive but not ours to signal". */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === 'EPERM');
  }
}

/**
 * True when something accepts a TCP connection on 127.0.0.1:port.
 * A 500ms timeout counts as "not listening" (SPEC §5.5 #3).
 */
function probePort(port, timeoutMs = DEFAULTS.portProbeMs) {
  return new Promise((resolve) => {
    const target = Number(port);
    if (!Number.isInteger(target) || target <= 0 || target > 65535) {
      resolve(false);
      return;
    }
    let settled = false;
    let socket;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      try {
        if (socket) socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(listening);
    };
    try {
      socket = net.connect({ host: '127.0.0.1', port: target });
    } catch {
      finish(false);
      return;
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(Math.max(1, Number(timeoutMs) || DEFAULTS.portProbeMs), () => finish(false));
  });
}

/**
 * Terminate one PID by number. ESRCH (already gone) counts as success.
 * On Windows process.kill maps to TerminateProcess.
 */
function killPid(pid, log) {
  if (!pidAlive(pid)) {
    if (log) log('kill', 'pid ' + pid + ' already gone');
    return true;
  }
  try {
    process.kill(pid);
    if (log) log('kill', 'signalled pid ' + pid);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') {
      if (log) log('kill', 'pid ' + pid + ' already gone');
      return true;
    }
    if (log) log('kill', 'failed to signal pid ' + pid + ': ' + messageOf(error));
    return false;
  }
}

/**
 * Absolute path to taskkill. The DSH host environment can carry a sanitized
 * PATH without C:\Windows\System32, where a bare "taskkill" is ENOENT.
 */
function taskkillPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const absolute = path.join(root, 'System32', 'taskkill.exe');
  try {
    if (fs.existsSync(absolute)) return absolute;
  } catch {
    /* fall through */
  }
  return 'taskkill';
}

/**
 * Force-kill one PID by number. Windows uses `taskkill /F /PID <pid>` and
 * deliberately never /T: a process tree would include this detached helper.
 */
function forceKill(pid, log) {
  if (!pidAlive(pid)) return true;
  if (process.platform === 'win32') {
    if (log) log('force', 'taskkill /F /PID ' + pid);
    try {
      const result = spawnSync(taskkillPath(), ['/F', '/PID', String(pid)], {
        windowsHide: true,
        stdio: 'ignore',
      });
      if (log) {
        log(
          'force',
          'taskkill pid ' + pid + ' exited ' + String(result.status) + (result.error ? ' (' + result.error.code + ')' : ''),
        );
      }
    } catch (error) {
      if (log) log('force', 'taskkill pid ' + pid + ' failed: ' + messageOf(error));
    }
    if (!pidAlive(pid)) return true;
    // Restricted tokens / job objects can deny taskkill even for our own
    // children (observed under the DSH sandbox). Fall back to the same
    // TerminateProcess system call through process.kill; still one PID only.
    if (log) log('force', 'taskkill did not terminate pid ' + pid + '; falling back to process.kill SIGKILL');
  } else if (log) {
    log('force', 'SIGKILL pid ' + pid);
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!error || error.code !== 'ESRCH') {
      if (log) log('force', 'SIGKILL pid ' + pid + ' failed: ' + messageOf(error));
      return false;
    }
  }
  return !pidAlive(pid);
}

/** Copy the environment without the variables that would confuse the app. */
function cleanEnv(env) {
  const out = { ...(env || {}) };
  for (const key of CLEAN_ENV_KEYS) delete out[key];
  return out;
}

/**
 * Wait until shell+host are gone AND the port refuses connections.
 * @returns {Promise<boolean>} true when released within exitWaitMs
 */
async function waitForRelease(cfg, timings, log) {
  const deadline = Date.now() + timings.exitWaitMs;
  while (Date.now() < deadline) {
    const shellGone = !pidAlive(cfg.shellPid);
    const hostGone = !pidAlive(cfg.hostPid);
    let portFree = true;
    if (cfg.port) portFree = !(await probePort(cfg.port, timings.portProbeMs));
    if (shellGone && hostGone && portFree) return true;
    await sleep(timings.pollMs);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Launch                                                              */
/* ------------------------------------------------------------------ */

function launchTarget(cfg) {
  if (cfg.testLaunch && typeof cfg.testLaunch === 'object') {
    return {
      file: String(cfg.testLaunch.file),
      args: Array.isArray(cfg.testLaunch.args) ? cfg.testLaunch.args.map(String) : [],
      test: true,
    };
  }
  return { file: cfg.appExe, args: [], test: false };
}

/**
 * Spawn one replacement process. Returns a handle with lazy exit/error state
 * so the caller can decide whether the launch succeeded.
 */
function launchReplacement(cfg, timings, log) {
  const target = launchTarget(cfg);
  const env = cleanEnv(process.env);
  if (log) log('launch', 'starting ' + target.file + (target.test ? ' (testLaunch)' : ''));
  let child;
  try {
    child = spawn(target.file, target.args, {
      cwd: cfg.appDir || undefined,
      detached: true,
      stdio: 'ignore',
      windowsHide: target.test ? true : false,
      env,
    });
  } catch (error) {
    if (log) log('launch', 'spawn threw: ' + messageOf(error));
    return { ok: false, reason: 'spawn-threw', error };
  }
  let exit = null;
  let spawnError = null;
  if (typeof child.on === 'function') {
    child.on('error', (error) => {
      spawnError = error;
      if (log) log('launch', 'spawn error: ' + messageOf(error));
    });
    child.on('exit', (code, signal) => {
      exit = { code, signal };
    });
  }
  try {
    child.unref();
  } catch {
    /* ignore */
  }
  if (log) log('launch', 'replacement pid ' + String(child.pid === undefined ? 'unknown' : child.pid));
  return {
    ok: true,
    pid: child.pid,
    child,
    getExit: () => exit,
    getError: () => spawnError,
  };
}

/**
 * Confirm the replacement is alive.
 *
 * The desktop host binds a RANDOM port on every boot, so the old port is not
 * a reliable success signal; it is polled opportunistically for the case the
 * port is reused (web mode). Success is: either the old port answers, or the
 * child is still alive after `startupSettleMs` (then we do not block for the
 * full 20s window — SPEC §5.5 #6).
 */
async function confirmStartup(launched, port, timings, log) {
  const startedAt = Date.now();
  const deadline = startedAt + timings.startupPollMs;
  while (Date.now() < deadline) {
    if (launched.getExit()) {
      const exit = launched.getExit();
      if (log) log('wait', 'replacement exited early (code ' + String(exit.code) + ')');
      return { ok: false, reason: 'early-exit' };
    }
    if (launched.getError() && !launched.pid) {
      if (log) log('wait', 'replacement could not be spawned');
      return { ok: false, reason: 'spawn-error' };
    }
    if (port) {
      const listening = await probePort(port, timings.portProbeMs);
      if (listening) {
        if (log) log('wait', 'port ' + port + ' answered; replacement is up');
        return { ok: true, verified: true };
      }
    }
    if (Date.now() - startedAt >= timings.startupSettleMs) {
      if (log) {
        log(
          'wait',
          'replacement alive for ' +
            String(timings.startupSettleMs) +
            'ms; desktop picks a new random port each boot, so spawn success is recorded unverified',
        );
      }
      return { ok: true, verified: false };
    }
    await sleep(timings.pollMs);
  }
  if (log) log('wait', 'replacement startup confirmation window elapsed');
  return { ok: true, verified: false };
}

/**
 * Launch and confirm, retrying once after a failed attempt (SPEC §5.5 #7).
 * @returns {Promise<{ok:boolean, pid?:number, verified?:boolean, reason?:string}>}
 */
async function launchWithRetry(cfg, timings, log) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const launched = launchReplacement(cfg, timings, log);
    if (launched.ok) {
      const confirmed = await confirmStartup(launched, cfg.port, timings, log);
      if (confirmed.ok) return { ok: true, pid: launched.pid, verified: confirmed.verified === true };
      if (log) log('retry', 'launch attempt ' + attempt + ' failed (' + String(confirmed.reason) + ')');
    } else if (log) {
      log('retry', 'launch attempt ' + attempt + ' failed (' + String(launched.reason) + ')');
    }
    if (attempt === 1) await sleep(timings.retryDelayMs);
  }
  return { ok: false, reason: 'launch-failed' };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

/**
 * Full restart sequence. Returns the process exit code (0 = replacement
 * launched, 1 = unrecoverable).
 */
async function main(argv = process.argv) {
  let cfg;
  try {
    cfg = parseConfig(argv[2]);
  } catch (error) {
    try {
      process.stderr.write(TAG + ': invalid config: ' + messageOf(error) + '\n');
    } catch {
      /* ignore */
    }
    return 1;
  }
  const timings = resolveTimings(cfg);
  const log = createLogger(cfg.logPath);
  activeLogger = log.write;
  log.write(
    'start',
    'helper pid ' +
      String(process.pid) +
      ' shell ' +
      String(cfg.shellPid) +
      ' host ' +
      String(cfg.hostPid) +
      ' trigger ' +
      String(cfg.trigger || 'button'),
  );
  if (cfg.createdAt) log.write('start', 'requested at ' + String(cfg.createdAt));

  try {
    await sleep(timings.delayMs);
    log.write('kill', 'terminating shell pid ' + String(cfg.shellPid));
    killPid(cfg.shellPid, log.write);

    const released = await waitForRelease(cfg, timings, log.write);
    if (!released) {
      log.write('timeout', 'shell/host/port still busy after ' + String(timings.exitWaitMs) + 'ms; forcing');
      forceKill(cfg.shellPid, log.write);
      forceKill(cfg.hostPid, log.write);
      await sleep(timings.forceWaitMs);
      if (pidAlive(cfg.shellPid) || pidAlive(cfg.hostPid)) {
        log.write('warn', 'process still alive after force kill; starting replacement anyway');
      }
    } else {
      log.write('wait', 'old shell/host gone and port released');
    }

    if (cfg.recoveryTask) {
      if (pidAlive(cfg.shellPid) || pidAlive(cfg.hostPid) || (cfg.port && await probePort(cfg.port,timings.portProbeMs))) {
        log.write('fatal','old instance is not fully released; profile recovery was not applied');
        return 1;
      }
      try {
        const { createRescue } = await import('./rescue.js');
        const task = cfg.recoveryTask;
        createRescue({profileDir:task.profileDir,stateDir:task.stateDir}).apply(task,{closed:true,hostPid:cfg.hostPid,shellPid:cfg.shellPid});
        log.write('recovery','applied '+task.action);
      } catch(error) {
        if(error.code==='profile-restore-required') { log.write('fatal','profile requires offline restoration; backup retained'); return 1; }
        log.write('recovery','not applied: '+String(error.code||'unknown')+'; relaunching existing profile, backup retained');
      }
    }
    const launched = await launchWithRetry(cfg, timings, log.write);
    if (!launched.ok) {
      log.write('fatal', 'replacement could not be started after retry');
      return 1;
    }
    log.write(
      'done ok',
      'replacement pid ' + String(launched.pid === undefined ? 'unknown' : launched.pid) + ' verified=' + String(launched.verified === true),
    );
    return 0;
  } catch (error) {
    try {
      log.write('fatal', error && error.stack ? error.stack : messageOf(error));
    } catch {
      /* ignore */
    }
    return 1;
  } finally {
    log.close();
    activeLogger = null;
  }
}

if (require.main === module) {
  process.on('uncaughtException', (error) => {
    try {
      if (activeLogger) activeLogger('fatal', 'uncaught exception: ' + (error && error.stack ? error.stack : messageOf(error)));
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    try {
      if (activeLogger) activeLogger('fatal', 'unhandled rejection: ' + messageOf(error));
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      try {
        if (activeLogger) activeLogger('fatal', messageOf(error));
      } catch {
        /* ignore */
      }
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULTS,
  CLEAN_ENV_KEYS,
  LOG_MAX_BYTES,
  main,
  parseConfig,
  resolveTimings,
  rotateLog,
  createLogger,
  pidAlive,
  probePort,
  killPid,
  forceKill,
  taskkillPath,
  cleanEnv,
  waitForRelease,
  launchTarget,
  launchReplacement,
  confirmStartup,
  launchWithRetry,
};
