/** Host adapters, request fencing, injection and restart/persistence helpers. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_TAG = '[dsh-bingo-ren]';
const FALLBACK_VERSION = '0.5.0';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Package root — lib/ is always a direct child (see SPEC §4). */
const PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');
const HELPER_PATH = path.join(MODULE_DIR, 'restart-helper.cjs');
const CLIENT_DIR = path.join(PACKAGE_ROOT, 'client');
const BODY_LIMIT_BYTES = 4096;
const INJECT_CLIENT_PATH = '/bingo/client.js';
const POSITION_GLOBAL = '__DSH_BINGO_POSITION__';
const RESTART_WATCHDOG_MS = 45000;
const STATE_FILE = 'state.json';
const LOG_FILE = 'restart.log';
const EVENTS_FILE = 'events.log';
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  pollMs: 4000,
  confirm: true,
  allowRestart: true,
  position: 'bottom-left',
  debug: false,
});

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function messageOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function writeLog(ctx, level, message) {
  const text = PLUGIN_TAG + ' ' + message;
  try {
    const logger = ctx && ctx.logger;
    if (logger && typeof logger[level] === 'function') {
      logger[level](text);
      return;
    }
  } catch {
    /* logging must never break the plugin */
  }
  try {
    if (level === 'warn' || level === 'error') console[level](text);
  } catch {
    /* ignore */
  }
}

function debugLog(ctx, cfg, message) {
  if (cfg && cfg.debug) writeLog(ctx, 'debug', message);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
}

/** Cached package version; package.json is C's file and may appear later. */
let cachedVersion = null;
function pluginVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    if (manifest && typeof manifest.version === 'string' && manifest.version) {
      cachedVersion = manifest.version;
    }
  } catch {
    /* fall back to the frozen contract version */
  }
  return cachedVersion || FALLBACK_VERSION;
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/**
 * Normalize/clamp the user config (SPEC §5.2). Every field is optional and
 * the defaults are part of the public contract, so this is pure and exported
 * for tests.
 */
export function normalizeConfig(config) {
  const raw = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const rawPoll = Number(raw.pollMs);
  const pollMs =
    Number.isFinite(rawPoll) && rawPoll > 0
      ? Math.min(60000, Math.max(1500, Math.round(rawPoll)))
      : DEFAULT_CONFIG.pollMs;
  return {
    enabled: raw.enabled !== false,
    pollMs,
    confirm: raw.confirm !== false,
    allowRestart: raw.allowRestart !== false,
    position: raw.position === 'bottom-right' ? 'bottom-right' : DEFAULT_CONFIG.position,
    debug: raw.debug === true,
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers (SPEC §5.6)                                            */
/* ------------------------------------------------------------------ */

/**
 * Signature of the plugin set a profile declares.
 *
 * The signature covers the sorted dependency entries AND the sorted
 * `dsh.profile.bundles` list so bundle-only changes (a bundle added without a
 * new dependency key) cannot slip through.
 *
 * @param {object} pkgJson parsed profile package.json
 * @returns {string} `sha256:<hex>`
 */
export function computeSignature(pkgJson) {
  const manifest = pkgJson && typeof pkgJson === 'object' ? pkgJson : {};
  const dependencies =
    manifest.dependencies && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies)
      ? manifest.dependencies
      : {};
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles.filter((entry) => typeof entry === 'string')
    : [];
  const payload = {
    dependencies: Object.keys(dependencies)
      .sort()
      .map((dep) => [dep, String(dependencies[dep])]),
    bundles: [...bundles].sort(),
  };
  return 'sha256:' + createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * The visible plugin list of a profile: the union of dependencies and
 * bundles, sorted by name. Bundle-only entries carry `version: null`.
 * @param {object} pkgJson parsed profile package.json
 * @returns {Array<{name: string, version: string|null}>}
 */
export function listPackages(pkgJson) {
  const manifest = pkgJson && typeof pkgJson === 'object' ? pkgJson : {};
  const dependencies =
    manifest.dependencies && typeof manifest.dependencies === 'object' && !Array.isArray(manifest.dependencies)
      ? manifest.dependencies
      : {};
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles.filter((entry) => typeof entry === 'string')
    : [];
  const composed = new Set(bundles);
  const names = new Set([...Object.keys(dependencies), ...bundles]);
  return [...names].sort().map((dep) => ({
    name: dep,
    version: Object.hasOwn(dependencies, dep) ? String(dependencies[dep]) : null,
    // A dependency that is not composed is installed but switched off; that is
    // exactly the difference rollback has to restore.
    enabled: composed.has(dep),
  }));
}

/**
 * Snapshot used by the detector: signature + visible package list.
 * @param {object} pkgJson parsed profile package.json
 */
export function snapshotPackages(pkgJson) {
  return { signature: computeSignature(pkgJson), packages: listPackages(pkgJson) };
}

/**
 * Compare a baseline snapshot with a fresh one.
 *
 * Returns `null` when the signature is unchanged (or there is no usable
 * baseline — startup always installs one first). Otherwise returns the new
 * signature and exactly the packages that did not exist before.
 *
 * @param {{signature?: string|null, packages?: Array<{name: string, version?: string|null}>}|null} baseline
 * @param {{signature: string, packages: Array<{name: string, version?: string|null}>}} current
 * @returns {{signature: string, packages: Array<{name: string, version: string|null}>}|null}
 */
export function diffPackages(baseline, current) {
  if (!current || typeof current !== 'object' || typeof current.signature !== 'string') return null;
  if (!baseline || typeof baseline !== 'object' || typeof baseline.signature !== 'string') return null;
  if (baseline.signature === current.signature) return null;
  const before = new Set(
    (Array.isArray(baseline.packages) ? baseline.packages : [])
      .map((entry) => (entry && typeof entry.name === 'string' ? entry.name : null))
      .filter(Boolean),
  );
  const added = (Array.isArray(current.packages) ? current.packages : [])
    .filter((entry) => entry && typeof entry.name === 'string' && !before.has(entry.name))
    .map((entry) => ({ name: entry.name, version: typeof entry.version === 'string' ? entry.version : null }));
  return { signature: current.signature, packages: added };
}

/**
 * Whether this host process is the official desktop host child.
 * Restart is only allowed there (SPEC §5.5).
 * @param {string} [argv1] usually process.argv[1]
 * @param {NodeJS.ProcessVersions} [versions] usually process.versions
 */
export function isDesktopHost(argv1 = process.argv[1], versions = process.versions) {
  if (!versions || !versions.electron) return false;
  return /dsh-desktop-host[\\/]lib[\\/]index\.js$/i.test(String(argv1 || ''));
}

/** DSH home: DSH_HOME override, else ~/.dsh (SPEC §2.2). */
function resolveDshHome(env) {
  const explicit = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), '.dsh');
}

/**
 * State/log directory: DSH_BINGO_HOME override, else <DSH_HOME>/bingo.
 * Test and sandbox runs redirect it so the real profile is never touched.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveStateDir(env = process.env) {
  const explicit = env && typeof env.DSH_BINGO_HOME === 'string' ? env.DSH_BINGO_HOME.trim() : '';
  if (explicit) return path.resolve(explicit);
  return path.join(resolveDshHome(env), 'bingo');
}

/**
 * Desktop profile directory. The profile services are authoritative because
 * the desktop shell exports a DSH_PROFILE_DIR that may point at a different
 * profile than the one actually hosting us (self-test profiles etc.); only
 * when no service is exposed do we trust the environment, then the
 * conventional `<DSH_HOME>/profiles/<DSH_PROFILE|desktop>` path.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{get?: (name: string) => any}|null} [ctx]
 * @returns {string}
 */
export function resolveProfileDir(env = process.env, ctx = null) {
  const fromContext = profileDirFromContext(ctx);
  if (fromContext) return fromContext;
  const explicit = env && typeof env.DSH_PROFILE_DIR === 'string' ? env.DSH_PROFILE_DIR.trim() : '';
  if (explicit) return path.resolve(explicit);
  const profileName =
    env && typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim()
      ? env.DSH_PROFILE.trim()
      : 'desktop';
  return path.join(resolveDshHome(env), 'profiles', profileName);
}

function profileDirFromContext(ctx) {
  if (!ctx || typeof ctx.get !== 'function') return null;
  try {
    const profile = ctx.get('profileContext');
    if (profile && typeof profile.dir === 'string' && profile.dir) return path.resolve(profile.dir);
  } catch {
    /* service not ready / probe error */
  }
  try {
    const desktopProfiles = ctx.get('desktopProfiles');
    const current = desktopProfiles && desktopProfiles.current;
    if (current && typeof current.dir === 'string' && current.dir) return path.resolve(current.dir);
  } catch {
    /* service not ready / probe error */
  }
  return null;
}

/** Profile display name for /bingo/status. */
function resolveProfileName(env, ctx, dir) {
  if (ctx && typeof ctx.get === 'function') {
    try {
      const profile = ctx.get('profileContext');
      if (profile && typeof profile.name === 'string' && profile.name) return profile.name;
    } catch {
      /* ignore */
    }
  }
  if (env && typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim()) return env.DSH_PROFILE.trim();
  if (dir) return path.basename(dir);
  return 'desktop';
}

/**
 * Loopback authority check used by the plugin's own fence.
 * Accepts localhost/*.localhost, ::1 and 127.0.0.0/8 only — a name such as
 * `127.0.0.1.evil.com` must not pass.
 * @param {string} hostname
 */
export function isLoopbackHostname(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  if (Number(match[1]) !== 127) return false;
  return [match[2], match[3], match[4]].every((part) => Number(part) <= 255);
}

/**
 * Build the trust fence for one connection service snapshot.
 *
 * Returns `(req) => status | null`; `null` means allowed. Order (SPEC §2.1):
 *  1. Host must parse; a non-loopback Host is only delegated to the host
 *     fence when that fence exists (otherwise 403).
 *  2. `sec-fetch-site: cross-site` -> 403.
 *  3. When Origin is present it must be same-origin with Host (the desktop
 *     protocol forward does not send Origin, so normal traffic passes).
 *  4. Host `connection.requestRejection` is delegated to; a throw is a
 *     rejection; a returned status code wins.
 * Any checker error is a rejection (fail closed).
 *
 * @param {{requestRejection?: (req: any) => number|boolean|null|undefined}|null|undefined} connection
 * @returns {(req: any) => number|null}
 */
export function buildFence(connection) {
  const fenceAvailable = Boolean(connection && typeof connection.requestRejection === 'function');
  return function fence(req) {
    try {
      const headers = (req && req.headers) || {};
      let hostUrl;
      try {
        hostUrl = new URL('http://' + String(headers.host || ''));
      } catch {
        return 403; // missing/malformed Host
      }
      const authority = hostUrl.host.toLowerCase();
      const hostname = hostUrl.hostname.toLowerCase();
      if (!isLoopbackHostname(hostname) && !fenceAvailable) return 403;
      const site = String(headers['sec-fetch-site'] || '').toLowerCase();
      if (site === 'cross-site') return 403;
      const origin = headers.origin;
      if (typeof origin === 'string' && origin && origin !== 'null') {
        let originUrl;
        try {
          originUrl = new URL(origin);
        } catch {
          return 403;
        }
        if (originUrl.host.toLowerCase() !== authority) return 403;
      }
      if (!fenceAvailable) return null;
      let code;
      try {
        code = connection.requestRejection(req);
      } catch {
        return 403; // a throwing fence is a rejection, never a pass
      }
      if (code === undefined || code === null || code === false) return null;
      return Number.isInteger(code) && code >= 400 && code <= 599 ? code : 403;
    } catch {
      return 403;
    }
  };
}

/* ------------------------------------------------------------------ */
/* Injection rows (SPEC §5.4)                                          */
/* ------------------------------------------------------------------ */

/**
 * Inline loader text. This is the ONLY desktop injection channel: the row is
 * a `script` row (textContent, not awaited) that creates the client <script>
 * itself and swallows load errors, so a missing /bingo/client.js can never
 * take the whole page boot down.
 * @param {string} version
 */
export function buildInjectText(version) {
  const query = encodeURIComponent(String(version || FALLBACK_VERSION));
  return (
    '(function(){try{if(window.__DSH_BINGO_LOADED__)return;' +
    'var d=document.body||document.head||document.documentElement;if(!d)return;' +
    'var s=document.createElement("script");' +
    's.src="' + INJECT_CLIENT_PATH + '?v=' + query + '";' +
    's.async=true;s.onerror=function(){};d.appendChild(s)}catch(e){}})()'
  );
}

/** Structured injection row for the desktop channel. */
export function buildInjectRow(version) {
  return { kind: 'script', placement: 'body', text: buildInjectText(version) };
}

/**
 * Append our rows to a collected injection table, once per table.
 * A row added by an earlier plugin version (or by hand) is detected by the
 * `/bingo/client.js` marker and left alone.
 * @param {Array<object>} table
 * @param {string} version
 * @param {'bottom-left'|'bottom-right'} position
 */
export function pushInjectionRows(table, version, position = DEFAULT_CONFIG.position) {
  if (!Array.isArray(table)) return false;
  let changed = false;
  const hasClientRow = table.some(
    (row) =>
      row &&
      row.kind === 'script' &&
      typeof row.text === 'string' &&
      row.text.includes(INJECT_CLIENT_PATH),
  );
  if (!hasClientRow) {
    table.push(buildInjectRow(version));
    changed = true;
  }
  const hasPosition = table.some((row) => row && row.kind === 'global' && row.name === POSITION_GLOBAL);
  if (!hasPosition) {
    table.push({ kind: 'global', name: POSITION_GLOBAL, value: position });
    changed = true;
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Restart helper (host side, SPEC §5.5)                               */
/* ------------------------------------------------------------------ */

/**
 * The JSON payload the detached helper receives as argv[2].
 * @param {{shellPid:number, hostPid:number, appExe:string, appDir:string, port:number|null, logPath:string, trigger?:string, delayMs?:number, createdAt?:string, testLaunch?:{file:string,args:string[]}}} input
 */
export function buildHelperConfig(input) {
  const port = Number(input.port);
  const cfg = {
    shellPid: Number(input.shellPid),
    hostPid: Number(input.hostPid),
    appExe: String(input.appExe),
    appDir: String(input.appDir),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
    logPath: String(input.logPath),
    trigger: typeof input.trigger === 'string' && input.trigger ? input.trigger : 'button',
    delayMs: Number.isFinite(Number(input.delayMs)) ? Number(input.delayMs) : 650,
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : new Date().toISOString(),
  };
  if (input.recoveryTask) cfg.recoveryTask = input.recoveryTask;
  if (input.testLaunch && typeof input.testLaunch === 'object') {
    cfg.testLaunch = {
      file: String(input.testLaunch.file),
      args: Array.isArray(input.testLaunch.args) ? input.testLaunch.args.map(String) : [],
    };
  }
  return cfg;
}

/**
 * Spawn the detached helper with Electron in Node mode.
 *
 * The child is detached + unref'd so it survives the shell being killed; it
 * receives the config as base64url JSON (no shell quoting, no temp file).
 *
 * @param {{helperPath?:string, execPath?:string, cfg:object, spawnImpl?:Function, env?:object, onError?:(error:Error)=>void}} options
 */
export function spawnRestartHelper(options) {
  const {
    helperPath = HELPER_PATH,
    execPath = process.execPath,
    cfg,
    spawnImpl = spawn,
    env = process.env,
    onError,
  } = options || {};
  if (!cfg || typeof cfg !== 'object') throw new Error('missing restart helper config');
  const payload = Buffer.from(JSON.stringify(cfg), 'utf8').toString('base64url');
  const child = spawnImpl(execPath, ['--expose-internals', helperPath, payload], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (!child || typeof child.unref !== 'function') throw new Error('restart helper spawn returned no handle');
  if (typeof child.on === 'function') {
    // Always consume the async 'error' event: an unhandled one would crash
    // the host after the route already answered 202.
    child.on('error', (error) => {
      if (typeof onError !== 'function') return;
      try {
        onError(error instanceof Error ? error : new Error(String(error)));
      } catch {
        /* ignore */
      }
    });
  }
  child.unref();
  return child;
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

function sendJson(res, status, body) {
  let text;
  try {
    text = JSON.stringify(body);
  } catch {
    text = '{"ok":false}';
    status = 500;
  }
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  } catch {
    try {
      res.end();
    } catch {
      /* client already gone */
    }
  }
}

function sendText(res, status, text, contentType) {
  try {
    res.writeHead(status, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(text, 'utf8'),
    });
    res.end(text);
  } catch {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Read and parse a JSON request body (max 4KB, SPEC §5.3).
 * Returns `{ok:true, value}` or `{ok:false, status, code}`.
 */
function readJsonBody(req, limit = BODY_LIMIT_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      req.on('data', (chunk) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > limit) {
          finish({ ok: false, status: 413, code: 'body-too-large' });
          return;
        }
        chunks.push(buffer);
      });
      req.on('end', () => {
        if (settled) return;
        const text = Buffer.concat(chunks).toString('utf8').trim();
        if (!text) {
          finish({ ok: true, value: {} });
          return;
        }
        let value;
        try {
          value = JSON.parse(text);
        } catch {
          finish({ ok: false, status: 400, code: 'invalid-json' });
          return;
        }
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          finish({ ok: false, status: 400, code: 'invalid-json' });
          return;
        }
        finish({ ok: true, value });
      });
      req.on('error', () => finish({ ok: false, status: 400, code: 'read-error' }));
    } catch {
      finish({ ok: false, status: 400, code: 'read-error' });
    }
  });
}

/* ------------------------------------------------------------------ */
/* State persistence                                                   */
/* ------------------------------------------------------------------ */

function sanitizePackageList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string')
    .map((entry) => ({ name: entry.name, version: typeof entry.version === 'string' ? entry.version : null }));
}

function sanitizePending(value) {
  if (!value || typeof value !== 'object' || typeof value.signature !== 'string' || !value.signature) return null;
  return {
    signature: value.signature,
    packages: sanitizePackageList(value.packages),
    detectedAt: typeof value.detectedAt === 'string' ? value.detectedAt : null,
  };
}

function sanitizeLastRestart(value, fallbackLog) {
  if (!value || typeof value !== 'object') return null;
  return {
    at: typeof value.at === 'string' ? value.at : null,
    trigger: typeof value.trigger === 'string' ? value.trigger : 'button',
    ok: typeof value.ok === 'boolean' ? value.ok : null,
    log: typeof value.log === 'string' && value.log ? value.log : fallbackLog || null,
  };
}

function sanitizeState(raw, fallbackLog) {
  const state = {
    baselineSignature: null,
    baselinePackages: [],
    acknowledgedSignature: null,
    pending: null,
    runtimeToken: null,
    lastRestart: null,
  };
  if (!raw || typeof raw !== 'object') return state;
  if (typeof raw.baselineSignature === 'string' && raw.baselineSignature) state.baselineSignature = raw.baselineSignature;
  state.baselinePackages = sanitizePackageList(raw.baselinePackages);
  if (typeof raw.acknowledgedSignature === 'string' && raw.acknowledgedSignature) {
    state.acknowledgedSignature = raw.acknowledgedSignature;
  }
  state.pending = sanitizePending(raw.pending);
  if (typeof raw.runtimeToken === 'string' && raw.runtimeToken) state.runtimeToken = raw.runtimeToken;
  state.lastRestart = sanitizeLastRestart(raw.lastRestart, fallbackLog);
  return state;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFileAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(value, null, 2) + '\n';
  const tmp = filePath + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch {
    try {
      fs.writeFileSync(filePath, text, 'utf8');
      return true;
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
      return false;
    }
  }
}

/** Last N bytes of a log file, or '' when unreadable. */
function readLogTail(logPath, maxBytes) {
  try {
    const stat = fs.statSync(logPath);
    const start = Math.max(0, stat.size - maxBytes);
    const length = stat.size - start;
    if (length <= 0) return '';
    const buffer = Buffer.allocUnsafe(length);
    const fd = fs.openSync(logPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Best-effort reconciliation of `lastRestart.ok` from the helper log tail
 * (SPEC §5.5 #10). Never blocks startup and never throws.
 */
function reconcileLastRestart(lastRestart, logPath) {
  if (!lastRestart) return null;
  if (lastRestart.ok === false) return lastRestart;
  const tail = readLogTail(logPath, 96 * 1024);
  if (!tail) return lastRestart;
  let outcome = null;
  for (const line of tail.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\] (done ok|done failed|fatal)\b/.exec(line);
    if (match) outcome = { at: match[1], ok: match[2] === 'done ok' };
  }
  if (!outcome) return lastRestart;
  if (lastRestart.at && outcome.at && outcome.at < lastRestart.at) return lastRestart;
  return { ...lastRestart, ok: outcome.ok };
}

export {
  messageOf,
  writeLog,
  debugLog,
  sleep,
  pluginVersion,
  resolveDshHome,
  resolveProfileName,
  sendJson,
  sendText,
  readJsonBody,
  sanitizePending,
  sanitizeState,
  readJsonFile,
  writeJsonFileAtomic,
  readLogTail,
  reconcileLastRestart,
  MODULE_DIR,
  HELPER_PATH,
  CLIENT_DIR,
  RESTART_WATCHDOG_MS,
  STATE_FILE,
  LOG_FILE,
  EVENTS_FILE,
  INJECT_CLIENT_PATH
};
