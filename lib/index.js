/**
 * dsh-bingo-ren — host plugin.
 *
 * A resident "Bingo" button for the official DeepSeek Harness desktop app:
 * status/detection over HTTP, plus a one-click whole-application restart.
 *
 * Contract: SPEC.md §5 (single source of truth).
 *
 * Design constraints that shaped this file:
 *  - The desktop shell collects the index-injection table ONCE at host start
 *    and ships it over IPC, so the injection row MUST be registered
 *    synchronously at the top of apply() — before any service is awaited.
 *  - The row is an inline `script` row (never `script-src`): a failing
 *    script-src row rejects the page boot. The inline loader creates the
 *    client <script> itself and swallows onerror.
 *  - Every route passes the trust fence first: loopback/同源 self-check and
 *    then the host `connection.requestRejection` when that security service
 *    exists (it is optional; `buildFence` fails closed without it).
 *  - Restart is only ever: detached helper -> kill the Electron shell PID by
 *    number -> wait for the process tree and port -> relaunch the exe.
 *    Never taskkill /T, never a restart IPC (the shell exposes none).
 *
 * No runtime dependencies: node builtins only.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Plugin name — used by Cordis for diagnostics. */
export const name = 'dsh-bingo-ren';
/**
 * Object-level inject MUST stay empty: a non-empty inject object delays
 * apply(), and the desktop injection table is only collected once. All
 * service waiting happens inside apply() via ctx.inject([...]).
 */
export const inject = [];

const PLUGIN_TAG = '[dsh-bingo-ren]';
const FALLBACK_VERSION = '0.1.3';
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
/**
 * Identifies this host process across Cordis recompositions. A recomposition
 * re-applies Bingo in the SAME process, so refreshing the baseline there would
 * swallow the very plugin install the market just triggered (observed with
 * dshmarket hot mounts). A full app restart gets a new token and does refresh
 * the baseline, because those plugins are already active.
 */
const RUNTIME_TOKEN = (() => {
  try {
    const key = '__DSH_BINGO_RUNTIME_TOKEN__';
    if (!globalThis[key]) globalThis[key] = randomUUID();
    return globalThis[key];
  } catch {
    return String(process.pid) + ':' + String(Date.now());
  }
})();
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
  const names = new Set([...Object.keys(dependencies), ...bundles]);
  return [...names].sort().map((dep) => ({
    name: dep,
    version: Object.hasOwn(dependencies, dep) ? String(dependencies[dep]) : null,
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

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

/**
 * Start the Bingo runtime against a live `webServer` service.
 *
 * This is where routes, the detector, and restart scheduling are wired. It is
 * exported so tests can run it with a fake webServer/context and injected
 * clock/process/spawn; production calls it from apply().
 *
 * @param {{webServer: any, get?: (name:string)=>any, effect?: Function, logger?: any}} hostCtx
 * @param {object} [config] user config (SPEC §5.2)
 * @param {object} [deps] test seams: env, stateDir, profileDir, profileName,
 *   isDesktop, spawn, execPath/helperPath, shellPid/hostPid/appExe/appDir,
 *   clientDir, settleMs, version, now
 */
export function createRuntime(hostCtx, config = {}, deps = {}) {
  const webServer = hostCtx && hostCtx.webServer;
  if (!webServer || typeof webServer.register !== 'function') {
    throw new Error('dsh-bingo-ren: webServer service is unavailable');
  }
  const cfg = normalizeConfig(config);
  const env = deps.env || process.env;
  const version = deps.version || pluginVersion();
  const stateDir = deps.stateDir || resolveStateDir(env);
  const statePath = path.join(stateDir, STATE_FILE);
  const logPath = path.join(stateDir, LOG_FILE);
  const fixedProfileDir = deps.profileDir || null;
  let profileDir = fixedProfileDir || resolveProfileDir(env, hostCtx);
  let profileName = deps.profileName || resolveProfileName(env, hostCtx, profileDir);
  let profilePkgPath = path.join(profileDir, 'package.json');
  const clientDir = deps.clientDir || CLIENT_DIR;
  const settleMs = Number.isFinite(Number(deps.settleMs)) ? Number(deps.settleMs) : 1200;
  const desktop = deps.isDesktop === undefined ? isDesktopHost() : Boolean(deps.isDesktop);
  const canRestart = desktop && cfg.allowRestart;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const clock = () => new Date(now()).toISOString();
  const spawnImpl = typeof deps.spawn === 'function' ? deps.spawn : spawn;

  const state = sanitizeState(readJsonFile(statePath), logPath);
  const runtimeToken = deps.runtimeToken || RUNTIME_TOKEN;
  const sameBoot = state.runtimeToken === runtimeToken;
  state.runtimeToken = runtimeToken;
  let lastRestart = reconcileLastRestart(state.lastRestart, logPath);
  if (lastRestart) state.lastRestart = lastRestart;
  let pending = sameBoot ? sanitizePending(state.pending) : null;
  let snapshot = null;
  let restarting = false;
  let detecting = false;
  let lastStat = null;
  let disposed = false;
  let pollTimer = null;
  let watchdog = null;
  let watcher = null;
  let detectTimer = null;
  const eventsPath = path.join(stateDir, EVENTS_FILE);
  const disposers = [];
  const routes = new Map();
  const assetCache = new Map();

  function debug(message) {
    debugLog(hostCtx, cfg, message);
  }

  function logWarn(message) {
    writeLog(hostCtx, 'warn', message);
  }

  function persistState() {
    const payload = {
      baselineSignature: state.baselineSignature,
      baselinePackages: state.baselinePackages,
      acknowledgedSignature: state.acknowledgedSignature,
      pending: state.pending,
      runtimeToken,
      lastRestart: state.lastRestart,
      updatedAt: clock(),
    };
    const written = writeJsonFileAtomic(statePath, payload);
    if (!written) debug('state write failed: ' + statePath);
    return written;
  }

  /** Append a support-friendly event line; never throws, never blocks. */
  function event(message) {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.appendFileSync(eventsPath, '[' + clock() + '] ' + message + '\n', 'utf8');
    } catch {
      /* diagnostics must never break the plugin */
    }
  }

  function stopWatch() {
    if (detectTimer) {
      clearTimeout(detectTimer);
      detectTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
      watcher = null;
    }
  }

  function scheduleDetect(delayMs) {
    if (disposed || detectTimer) return;
    detectTimer = setTimeout(() => {
      detectTimer = null;
      detectNow().catch((error) => debug('watcher detection failed: ' + messageOf(error)));
    }, Number.isFinite(delayMs) ? delayMs : 160);
    if (detectTimer && typeof detectTimer.unref === 'function') detectTimer.unref();
  }

  function startWatch() {
    stopWatch();
    try {
      watcher = fs.watch(profileDir, { persistent: false }, (_eventName, filename) => {
        if (filename !== null && filename !== undefined && String(filename).toLowerCase() !== 'package.json') return;
        scheduleDetect(160);
      });
      watcher.on('error', () => {
        stopWatch();
        debug('profile watcher unavailable; polling only');
      });
    } catch (error) {
      watcher = null;
      debug('profile watcher unavailable: ' + messageOf(error));
    }
  }

  function getConnection() {
    try {
      if (hostCtx && typeof hostCtx.get === 'function') {
        const connection = hostCtx.get('connection');
        if (connection) return connection;
      }
    } catch {
      /* service probe must not break requests */
    }
    return null;
  }

  function fenceRequest(req) {
    return buildFence(getConnection())(req);
  }

  function webServerPort() {
    try {
      const port = webServer && webServer.port;
      return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
      return null;
    }
  }

  function readProfileManifest() {
    return readJsonFile(profilePkgPath);
  }

  function statProfile() {
    try {
      const stat = fs.statSync(profilePkgPath);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  }

  function installBaseline(pkgJson, reason) {
    snapshot = snapshotPackages(pkgJson);
    state.baselineSignature = snapshot.signature;
    state.baselinePackages = snapshot.packages;
    state.pending = null;
    pending = null;
    persistState();
    event('baseline installed (' + (reason || 'startup') + ') ' + snapshot.signature);
    debug('baseline installed: ' + snapshot.signature);
  }

  /**
   * Re-resolve the profile directory, preferring the live host services over
   * the inherited environment. Cordis may mount profileContext after us, and
   * the desktop shell's DSH_PROFILE_DIR can name a DIFFERENT profile than the
   * one actually hosting this host (self-test profiles), so this is checked
   * lazily on status/detection instead of frozen at plugin apply time.
   * Switching profiles re-installs the baseline: the newly identified
   * profile's already-installed plugins must not look "new".
   */
  function sameDir(a, b) {
    try {
      return fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();
    } catch {
      try {
        return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
      } catch {
        return false;
      }
    }
  }

  function ensureProfile() {
    if (fixedProfileDir) return profileDir;
    const next = resolveProfileDir(env, hostCtx);
    if (next !== profileDir) {
      // Windows case/realpath spelling differences are not a profile switch;
      // re-baselining there would swallow a plugin installed at that moment.
      if (sameDir(next, profileDir)) {
        profileDir = next;
        profilePkgPath = path.join(next, 'package.json');
        return profileDir;
      }
      const previous = profileDir;
      profileDir = next;
      profileName = resolveProfileName(env, hostCtx, next);
      profilePkgPath = path.join(next, 'package.json');
      state.pending = null;
      pending = null;
      if (!disposed) {
        const manifest = readProfileManifest();
        if (manifest) {
          installBaseline(manifest, 'profile-change');
        } else {
          // The service points at a profile we cannot read yet. Drop the
          // previous profile's baseline so its plugin list is not reported as
          // "new" once this profile becomes readable.
          state.baselineSignature = null;
          state.baselinePackages = [];
          persistState();
        }
        lastStat = statProfile();
        startWatch();
        event('profile changed ' + previous + ' -> ' + profileDir);
        debug('profile resolved to ' + profileDir + ' (' + profileName + ')');
      }
    }
    return profileDir;
  }

  // A full app boot refreshes the baseline: plugins installed while the app
  // was closed are already active. A same-process Cordis recomposition (for
  // example dshmarket's hot mount) must PRESERVE the baseline and pending
  // record, otherwise the install that triggered the recomposition is adopted
  // silently and no prompt ever appears.
  try {
    ensureProfile();
    const initialManifest = readProfileManifest();
    if (initialManifest) {
      if (!sameBoot || !state.baselineSignature) {
        installBaseline(initialManifest, sameBoot ? 'missing-baseline' : 'new-boot');
      } else {
        snapshot = snapshotPackages(initialManifest);
        pending = sanitizePending(state.pending);
        // The manifest may already contain the install that caused this
        // recomposition. It has not been compared with the saved baseline yet.
        lastStat = null;
        event('same-boot recomposition: baseline preserved' + (pending ? ' (pending restored)' : ''));
      }
    } else {
      debug('profile package.json unavailable: ' + profilePkgPath);
    }
  } catch (error) {
    debug('baseline refresh failed: ' + messageOf(error));
  }
  startWatch();
  if (lastRestart || state.runtimeToken) persistState();
  if (sameBoot) scheduleDetect(0);

  /**
   * One detection pass. Safe to call while a pass is in flight (it is a
   * no-op) and from tests. Returns the current pending record.
   */
  async function detectNow() {
    if (disposed || detecting) return pending;
    detecting = true;
    try {
      ensureProfile();
      const stat = statProfile();
      if (!stat) return pending;
      const previous = lastStat;
      lastStat = stat;
      if (previous && previous.mtimeMs === stat.mtimeMs && previous.size === stat.size) return pending;
      // pnpm writes package.json non-atomically; let it settle first.
      await sleep(settleMs);
      if (disposed) return pending;
      const manifest = readProfileManifest();
      if (!manifest) return pending;
      const fresh = snapshotPackages(manifest);
      snapshot = fresh;
      if (!state.baselineSignature) {
        installBaseline(manifest);
        return pending;
      }
      if (fresh.signature === state.baselineSignature) {
        if (pending && pending.signature !== fresh.signature) {
          pending = null;
          state.pending = null;
          persistState();
          event('pending cleared: manifest returned to baseline');
        }
        return pending;
      }
      const diff = diffPackages(
        { signature: state.baselineSignature, packages: state.baselinePackages },
        fresh,
      );
      const added = diff ? diff.packages : [];
      const acknowledged = state.acknowledgedSignature === fresh.signature;
      if (added.length > 0 && !acknowledged) {
        if (!pending || pending.signature !== fresh.signature) {
          pending = {
            signature: fresh.signature,
            packages: added,
            detectedAt: clock(),
          };
          state.pending = pending;
          persistState();
          event('pending new plugins: ' + added.map((entry) => entry.name).join(', '));
        }
        debug('pending new plugins: ' + added.map((entry) => entry.name).join(', '));
        return pending;
      }
      // Nothing *new* (version-only change, removal, or an acknowledged
      // signature): advance the baseline silently.
      const hadPending = pending !== null;
      state.baselineSignature = fresh.signature;
      state.baselinePackages = fresh.packages;
      state.pending = null;
      pending = null;
      persistState();
      if (hadPending) event('pending cleared: acknowledged or version-only change');
      return pending;
    } catch (error) {
      debug('detection pass failed: ' + messageOf(error));
      return pending;
    } finally {
      detecting = false;
    }
  }

  function dismiss(signature) {
    if (!pending || typeof signature !== 'string' || signature !== pending.signature) return false;
    state.acknowledgedSignature = signature;
    state.baselineSignature = snapshot ? snapshot.signature : pending.signature;
    state.baselinePackages = snapshot ? snapshot.packages : pending.packages;
    state.pending = null;
    pending = null;
    persistState();
    event('pending acknowledged: ' + signature);
    debug('pending acknowledged: ' + signature);
    return true;
  }

  function status() {
    ensureProfile();
    return {
      ok: true,
      version,
      desktop,
      canRestart,
      restarting,
      pollMs: cfg.pollMs,
      position: cfg.position,
      confirm: cfg.confirm,
      profile: { name: profileName, dir: profileDir },
      pending: pending
        ? {
            signature: pending.signature,
            packages: pending.packages.map((entry) => ({ name: entry.name, version: entry.version })),
            detectedAt: pending.detectedAt,
          }
        : null,
      lastRestart: lastRestart
        ? {
            at: lastRestart.at,
            trigger: lastRestart.trigger,
            ok: lastRestart.ok,
            log: lastRestart.log,
          }
        : null,
    };
  }

  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (disposed || !restarting) return;
      // If we are still alive after this long, the helper never terminated
      // this host. Reset so the user can retry instead of facing a dead button.
      restarting = false;
      lastRestart = { ...(lastRestart || {}), at: lastRestart?.at || clock(), trigger: lastRestart?.trigger || 'button', ok: false, log: logPath };
      state.lastRestart = lastRestart;
      persistState();
      logWarn('restart helper did not terminate the host within ' + RESTART_WATCHDOG_MS + 'ms; resetting restarting state');
    }, RESTART_WATCHDOG_MS);
    if (watchdog && typeof watchdog.unref === 'function') watchdog.unref();
  }

  function scheduleRestart(trigger) {
    if (!canRestart) return { status: 409, body: { ok: false, code: 'unsupported' } };
    if (restarting) return { status: 409, body: { ok: false, code: 'restarting' } };
    const attempt = { at: clock(), trigger, ok: true, log: logPath };
    let helperConfig;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      helperConfig = buildHelperConfig({
        shellPid: deps.shellPid === undefined ? process.ppid : deps.shellPid,
        hostPid: deps.hostPid === undefined ? process.pid : deps.hostPid,
        appExe: deps.appExe === undefined ? process.execPath : deps.appExe,
        appDir: deps.appDir === undefined ? path.dirname(process.execPath) : deps.appDir,
        port: webServerPort(),
        logPath,
        trigger,
        delayMs: 650,
        createdAt: attempt.at,
      });
    } catch (error) {
      return { status: 500, body: { ok: false, code: 'spawn-failed', message: messageOf(error) } };
    }
    restarting = true;
    lastRestart = attempt;
    state.lastRestart = attempt;
    persistState();
    try {
      spawnRestartHelper({
        helperPath: deps.helperPath || HELPER_PATH,
        execPath: deps.execPath || process.execPath,
        cfg: helperConfig,
        spawnImpl,
        env,
        onError: (error) => {
          if (disposed) return;
          restarting = false;
          lastRestart = { ...attempt, ok: false };
          state.lastRestart = lastRestart;
          persistState();
          logWarn('restart helper failed asynchronously: ' + messageOf(error));
        },
      });
      armWatchdog();
      debug('restart scheduled (' + trigger + '), helper log: ' + logPath);
      return { status: 202, body: { ok: true, scheduled: true } };
    } catch (error) {
      restarting = false;
      lastRestart = { ...attempt, ok: false };
      state.lastRestart = lastRestart;
      persistState();
      logWarn('restart helper spawn threw: ' + messageOf(error));
      return { status: 500, body: { ok: false, code: 'spawn-failed', message: messageOf(error) } };
    }
  }

  /* ----------------------------- routes ----------------------------- */

  function registerRoute(method, routePath, handler) {
    const route = {
      kind: 'exact',
      path: routePath,
      handler: (req, res) => {
        try {
          const rejection = fenceRequest(req);
          if (rejection) {
            sendJson(res, rejection, { ok: false });
            return;
          }
          const requestMethod = String((req && req.method) || 'GET').toUpperCase();
          if (requestMethod !== method) {
            sendJson(res, 405, { ok: false, code: 'method-not-allowed' });
            return;
          }
          Promise.resolve(handler(req, res)).catch((error) => {
            debug('route ' + routePath + ' failed: ' + messageOf(error));
            sendJson(res, 500, { ok: false, code: 'internal' });
          });
        } catch (error) {
          debug('route ' + routePath + ' threw: ' + messageOf(error));
          sendJson(res, 500, { ok: false, code: 'internal' });
        }
      },
    };
    const dispose = webServer.register(route);
    routes.set(routePath, route);
    if (typeof dispose === 'function') disposers.push(dispose);
    return dispose;
  }

  function readAsset(filePath, contentType) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      assetCache.delete(filePath);
      return null;
    }
    const cached = assetCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const entry = { text, mtimeMs: stat.mtimeMs, size: stat.size, contentType };
      assetCache.set(filePath, entry);
      return entry;
    } catch {
      return null;
    }
  }

  registerRoute('GET', '/bingo/status', async (req, res) => {
    sendJson(res, 200, status());
  });

  registerRoute('POST', '/bingo/restart', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.ok) {
      sendJson(res, body.status, { ok: false, code: body.code });
      return;
    }
    const trigger =
      body.value.trigger === 'new-plugin' || body.value.trigger === 'shortcut' ? body.value.trigger : 'button';
    const result = scheduleRestart(trigger);
    sendJson(res, result.status, result.body);
  });

  registerRoute('POST', '/bingo/dismiss', async (req, res) => {
    const body = await readJsonBody(req);
    if (!body.ok) {
      sendJson(res, body.status, { ok: false, code: body.code });
      return;
    }
    const acknowledged = dismiss(body.value.signature);
    if (!acknowledged) {
      sendJson(res, 409, { ok: false, code: 'no-pending' });
      return;
    }
    sendJson(res, 200, { ok: true });
  });

  registerRoute('GET', '/bingo/client.js', async (req, res) => {
    const asset = readAsset(path.join(clientDir, 'bingo-client.js'), 'application/javascript; charset=utf-8');
    if (!asset) {
      sendJson(res, 404, { ok: false, code: 'not-found' });
      return;
    }
    sendText(res, 200, asset.text, asset.contentType);
  });

  registerRoute('GET', '/bingo/client.css', async (req, res) => {
    const asset = readAsset(path.join(clientDir, 'bingo-client.css'), 'text/css; charset=utf-8');
    if (!asset) {
      sendJson(res, 404, { ok: false, code: 'not-found' });
      return;
    }
    sendText(res, 200, asset.text, asset.contentType);
  });

  // Unknown /bingo/* stays inside us (404 JSON) instead of falling through to
  // the SPA dist server, which would answer 200 + index.html.
  const prefixRoute = {
    kind: 'prefix',
    path: '/bingo',
    handler: (req, res) => {
      const rejection = fenceRequest(req);
      if (rejection) {
        sendJson(res, rejection, { ok: false });
        return;
      }
      sendJson(res, 404, { ok: false, code: 'not-found' });
    },
  };
  const prefixDisposer = webServer.register(prefixRoute);
  routes.set(prefixRoute.path, prefixRoute);
  if (typeof prefixDisposer === 'function') disposers.push(prefixDisposer);

  // Web-shape fallback for hosts that never emit the structured table.
  if (typeof webServer.tapIndex === 'function') {
    const tag = '<script defer src="' + INJECT_CLIENT_PATH + '?v=' + encodeURIComponent(String(version)) + '"></script>';
    try {
      const tapDisposer = webServer.tapIndex((html) => {
        if (typeof html !== 'string') return html;
        if (html.includes(INJECT_CLIENT_PATH)) return html;
        if (html.includes('</body>')) return html.replace('</body>', tag + '</body>');
        return html + tag;
      });
      if (typeof tapDisposer === 'function') disposers.push(tapDisposer);
    } catch (error) {
      debug('tapIndex registration failed: ' + messageOf(error));
    }
  }

  if (!getConnection()) {
    logWarn(
      'host connection fence unavailable (connection.requestRejection missing): routes rely on the built-in ' +
        'loopback/same-origin fence. Non-loopback Hosts are rejected while the fence is absent.',
    );
  }

  // Detector loop: a cheap stat() every pollMs (SPEC §2.2), paused logic is
  // the client's concern; the host timer is tiny and unref'd.
  pollTimer = setInterval(() => {
    detectNow().catch((error) => debug('detector iteration failed: ' + messageOf(error)));
  }, cfg.pollMs);
  if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopWatch();
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
    for (const disposeRoute of disposers.splice(0)) {
      try {
        disposeRoute();
      } catch {
        /* ignore */
      }
    }
    routes.clear();
    assetCache.clear();
  }

  return {
    config: cfg,
    version,
    stateDir,
    statePath,
    logPath,
    get profileDir() {
      return ensureProfile();
    },
    get profileName() {
      ensureProfile();
      return profileName;
    },
    routes,
    get pending() {
      return pending;
    },
    get restarting() {
      return restarting;
    },
    status,
    detectNow,
    dismiss,
    scheduleRestart,
    dispose,
  };
}

/* ------------------------------------------------------------------ */
/* Cordis plugin                                                       */
/* ------------------------------------------------------------------ */

/**
 * Plugin entry (SPEC §5.1). Order is mandatory:
 *  1. Synchronously subscribe to the index-injection table and push our row
 *     on every collection — no service is awaited first.
 *  2. Wait for webServer via ctx.inject and start the runtime.
 *  3. Clean up the subscription interval/routes on dispose.
 *
 * `connection` is resolved per request (like the reference plugin does with
 * `ctx.get('connection')`) instead of being a hard inject dependency: the
 * service is optional across supported host versions, and a hard dependency
 * would leave the plugin inactive — and therefore the button missing — on
 * hosts that do not provide it.
 */
export function apply(ctx, config) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) {
    debugLog(ctx, cfg, 'disabled by config; no injection row and no routes');
    return;
  }
  const version = pluginVersion();
  const rowDisposers = [];
  // 1. Injection row FIRST, synchronously.
  try {
    const off = ctx.on('webserver/index-inject', (table) => {
      try {
        pushInjectionRows(table, version, cfg.position);
      } catch (error) {
        debugLog(ctx, cfg, 'failed to push injection rows: ' + messageOf(error));
      }
    });
    if (typeof off === 'function') rowDisposers.push(off);
  } catch (error) {
    debugLog(ctx, cfg, 'failed to subscribe to webserver/index-inject: ' + messageOf(error));
  }
  try {
    ctx.effect(() => () => {
      for (const dispose of rowDisposers.splice(0)) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
    });
  } catch {
    /* hosts without effect cleanup still get the row via the listener */
  }
  // 2. Everything service-dependent waits here.
  ctx.inject(['webServer'], (hostCtx) => {
    let runtime;
    try {
      runtime = createRuntime(hostCtx, cfg);
    } catch (error) {
      writeLog(ctx, 'error', 'failed to start runtime: ' + messageOf(error));
      return;
    }
    // 3. Runtime cleanup on plugin dispose / webServer re-registration.
    try {
      hostCtx.effect(() => () => runtime.dispose());
    } catch {
      // Fall back to the root effect if the child context has no effect().
      try {
        ctx.effect(() => () => runtime.dispose());
      } catch {
        /* last resort: the process is going away anyway */
      }
    }
  });
}

export default {
  name,
  inject,
  apply,
};
