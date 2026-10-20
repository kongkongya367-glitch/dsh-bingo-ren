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
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseRestartLog, recentRestarts, restartStats, restartSummary } from './timeline.js';
import { profileKey } from './local-state.js';
import { createPluginManagement } from './plugin-management.js';
import {
  normalizeConfig,
  snapshotPackages,
  diffPackages,
  isDesktopHost,
  resolveStateDir,
  resolveProfileDir,
  buildFence,
  pushInjectionRows,
  buildHelperConfig,
  spawnRestartHelper,
  messageOf,
  writeLog,
  debugLog,
  sleep,
  pluginVersion,
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
  HELPER_PATH,
  CLIENT_DIR,
  RESTART_WATCHDOG_MS,
  STATE_FILE,
  LOG_FILE,
  EVENTS_FILE,
  INJECT_CLIENT_PATH
} from './host-support.js';

export {
  normalizeConfig,
  computeSignature,
  listPackages,
  snapshotPackages,
  diffPackages,
  isDesktopHost,
  resolveStateDir,
  resolveProfileDir,
  isLoopbackHostname,
  buildFence,
  buildInjectText,
  buildInjectRow,
  pushInjectionRows,
  buildHelperConfig,
  spawnRestartHelper
} from './host-support.js';

export const name = 'dsh-bingo-ren';
// Injection must be registered before waiting for any host service.
export const inject = [];

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
  const management = createPluginManagement({
    hostCtx, env, stateDir, version, runtimeToken, sameBoot, canRestart, deps, now, clock,
    getProfileDir: () => profileDir, ensureProfile, readProfileManifest,
    scheduleRestart, registerRoute, debug, event, isRestarting: () => restarting,
  });
  const { activity, observeActivity, recordBoot, readLegacySafeMode, applyRollback } = management;

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


  /* --------------------------- restart timeline -------------------------- */

  /**
   * One report row per recent restart: how long it took, and which plugins were
   * waiting on it. Durations come from the helper log; the plugin list comes
   * from the journal entry recorded right before that restart.
   */
  function timelineReport(limit = 8) {
    const tail = readLogTail(logPath, 96 * 1024);
    const attempts = recentRestarts(tail, limit);
    const journal = activity();
    const items = attempts.map((attempt) => {
      const at = attempt.startedAt || null;
      const around = journal.changesAround(at);
      return {
        ...restartSummary({
          requestedAt: attempt.startedAt,
          bootedAt: attempt.doneAt,
          phases: attempt.durations,
          trigger: attempt.trigger || null,
          ok: attempt.ok,
          log: logPath,
        }),
        plugins: around,
      };
    });
    return {
      ok: true,
      stats: restartStats(attempts),
      lastRestart: lastRestart
        ? restartSummary({
            requestedAt: lastRestart.at || null,
            bootedAt: null,
            phases: items.length ? items[0].phases : null,
            trigger: lastRestart.trigger || null,
            ok: lastRestart.ok,
            log: lastRestart.log || logPath,
          })
        : null,
      items,
    };
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
    recordBoot(pkgJson);
    observeActivity(pkgJson, 'startup');
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
        recordBoot(initialManifest);
        observeActivity(initialManifest, 'running');
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
      observeActivity(manifest, 'running');
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
      bootId: runtimeToken + ':' + profileKey(profileDir),
      desktop,
      canRestart,
      restarting,
      pollMs: cfg.pollMs,
      position: cfg.position,
      confirm: cfg.confirm,
      activity: activity().summary(),
      safeMode: readLegacySafeMode(),
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

  function scheduleRestart(trigger, recoveryTask = null) {
    if (!canRestart) return { status: 409, body: { ok: false, code: 'unsupported' } };
    if (management.busy()) return { status: 409, body: { ok: false, code: 'operation-busy' } };
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
        recoveryTask,
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

  management.registerRoutes();

  registerRoute('GET', '/bingo/timeline', async (req, res) => {
    ensureProfile();
    sendJson(res, 200, timelineReport());
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

  registerRoute('GET', '/bingo/tools.js', async (req, res) => {
    const asset = readAsset(path.join(clientDir, 'bingo-tools.js'), 'application/javascript; charset=utf-8');
    if (!asset) return sendJson(res, 404, { ok: false, code: 'not-found' });
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
    recovery: () => management.view(),
    timeline: () => timelineReport(),
    applyRollback,
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
