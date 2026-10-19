import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import plugin, {
  apply,
  buildFence,
  buildHelperConfig,
  buildInjectRow,
  buildInjectText,
  computeSignature,
  createRuntime,
  diffPackages,
  inject,
  isDesktopHost,
  isLoopbackHostname,
  listPackages,
  name as pluginName,
  normalizeConfig,
  pushInjectionRows,
  resolveProfileDir,
  resolveStateDir,
  snapshotPackages,
  spawnRestartHelper,
} from '../lib/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_ROOT = path.join(ROOT, '.tmp');
const NL = String.fromCharCode(10);
const ENV_KEYS = ['DSH_BINGO_HOME', 'DSH_PROFILE_DIR', 'DSH_PROFILE', 'DSH_HOME'];

/* ------------------------------------------------------------------ */
/* Test helpers                                                        */
/* ------------------------------------------------------------------ */

function makeTempDir(label) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, 'host-' + label + '-'));
}

function writeProfile(profileDir, manifest) {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function createFakeWebServer(port) {
  const routes = new Map();
  const taps = [];
  return {
    port: port === undefined ? 4321 : port,
    routes,
    taps,
    register(route) {
      if (routes.has(route.path)) throw new Error('duplicate route ' + route.path);
      routes.set(route.path, route);
      return () => {
        routes.delete(route.path);
      };
    },
    tapIndex(transform) {
      taps.push(transform);
      return () => {
        const index = taps.indexOf(transform);
        if (index >= 0) taps.splice(index, 1);
      };
    },
  };
}

function createHostContext(options) {
  const opts = options || {};
  const webServer = opts.webServer || createFakeWebServer();
  const services = {
    webServer,
    connection: opts.connection === undefined ? null : opts.connection,
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  return {
    webServer,
    logger,
    get(service) {
      return Object.hasOwn(services, service) ? services[service] : null;
    },
    effect(callback) {
      const disposer = callback();
      return () => {
        try {
          if (typeof disposer === 'function') disposer();
        } catch (error) {
          /* ignore */
        }
      };
    },
    on() {
      return () => {};
    },
  };
}

function createFakeResponse() {
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
      return this;
    },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk);
      resolveDone({ status: this.statusCode, headers: this.headers, body: this.body });
    },
  };
  res.done = done;
  return res;
}

async function callRoute(runtime, routePath, options) {
  const opts = options || {};
  const route = runtime.routes.get(routePath);
  assert.ok(route, 'route must be registered: ' + routePath);
  const chunks = opts.body === undefined || opts.body === null ? [] : [Buffer.from(String(opts.body))];
  const req = Readable.from(chunks);
  req.method = opts.method || 'GET';
  req.headers = opts.headers || { host: '127.0.0.1:4321' };
  req.url = routePath;
  const res = createFakeResponse();
  route.handler(req, res);
  const result = await res.done;
  result.json = function json() {
    return JSON.parse(this.body);
  };
  return result;
}

function setupRuntime(options) {
  const opts = options || {};
  const dir = makeTempDir(opts.label || 'rt');
  const profileDir = path.join(dir, 'profile');
  const stateDir = path.join(dir, 'bingo');
  fs.mkdirSync(stateDir, { recursive: true });
  const manifest =
    opts.packageJson === undefined
      ? { dependencies: {}, dsh: { profile: { bundles: [] } } }
      : opts.packageJson;
  writeProfile(profileDir, manifest);
  if (opts.state) {
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(opts.state), 'utf8');
  }
  if (opts.logText) {
    fs.writeFileSync(path.join(stateDir, 'restart.log'), opts.logText, 'utf8');
  }
  const webServer = createFakeWebServer(opts.port);
  const hostCtx = createHostContext({ webServer, connection: opts.connection });
  const env = {
    DSH_BINGO_HOME: stateDir,
    DSH_PROFILE_DIR: profileDir,
    DSH_PROFILE: 'test-profile',
    DSH_HOME: dir,
  };
  const spawnCalls = [];
  let spawnImpl;
  if (opts.spawn) {
    spawnImpl = opts.spawn;
  } else if (opts.spawnThrows) {
    spawnImpl = function () {
      throw new Error('spawn boom');
    };
  } else {
    spawnImpl = function (file, args, spawnOptions) {
      const call = { file, args: args.slice(), options: spawnOptions };
      spawnCalls.push(call);
      return {
        pid: 7777,
        on() {},
        unref() {
          call.unrefCalled = true;
        },
      };
    };
  }
  const runtime = createRuntime(hostCtx, opts.config || {}, {
    env,
    stateDir,
    profileDir,
    settleMs: opts.settleMs === undefined ? 0 : opts.settleMs,
    isDesktop: Boolean(opts.desktop),
    spawn: spawnImpl,
    version: '9.9.9',
    clientDir: opts.clientDir || path.join(dir, 'client'),
    shellPid: 4242,
    hostPid: 4343,
    appExe: 'C:/fake/DeepSeek Harness.exe',
    appDir: 'C:/fake',
    execPath: 'C:/fake/DeepSeek Harness.exe',
    helperPath: 'C:/fake/lib/restart-helper.cjs',
    now: opts.now,
  });
  return {
    dir,
    profileDir,
    stateDir,
    profilePkgPath: path.join(profileDir, 'package.json'),
    webServer,
    hostCtx,
    env,
    runtime,
    spawnCalls,
  };
}

function cleanup(ctx, t) {
  if (t && typeof t.after === 'function') {
    t.after(() => {
      try {
        ctx.runtime.dispose();
      } catch (error) {
        /* ignore */
      }
      try {
        fs.rmSync(ctx.dir, { recursive: true, force: true });
      } catch (error) {
        /* ignore */
      }
    });
  }
}

function withTempEnv(callback) {
  const dir = makeTempDir('env');
  const profileDir = path.join(dir, 'profile');
  writeProfile(profileDir, { dependencies: {}, dsh: { profile: { bundles: [] } } });
  const stateDir = path.join(dir, 'bingo');
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.DSH_BINGO_HOME = stateDir;
  process.env.DSH_PROFILE_DIR = profileDir;
  process.env.DSH_PROFILE = 'test-profile';
  process.env.DSH_HOME = dir;
  try {
    return callback({ dir, profileDir, stateDir });
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function createRootContext(webServer, connection) {
  const listeners = new Map();
  const effects = [];
  const calls = [];
  const services = { webServer, connection: connection === undefined ? null : connection };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const root = {
    logger,
    calls,
    effects,
    listeners,
    on(event, callback) {
      calls.push({ type: 'on', event });
      const bucket = listeners.get(event) || [];
      bucket.push(callback);
      listeners.set(event, bucket);
      return () => {
        const index = bucket.indexOf(callback);
        if (index >= 0) bucket.splice(index, 1);
      };
    },
    emit(event) {
      const args = Array.prototype.slice.call(arguments, 1);
      for (const callback of (listeners.get(event) || []).slice()) callback.apply(null, args);
    },
    effect(callback) {
      calls.push({ type: 'effect' });
      const disposer = callback();
      effects.push(disposer);
      return () => {
        if (typeof disposer === 'function') disposer();
      };
    },
    inject(dependencies, callback) {
      calls.push({ type: 'inject', dependencies: dependencies.slice() });
      const hostCtx = {
        webServer,
        logger,
        get(service) {
          return Object.hasOwn(services, service) ? services[service] : null;
        },
        effect(inner) {
          const disposer = inner();
          effects.push(disposer);
          return () => {
            if (typeof disposer === 'function') disposer();
          };
        },
      };
      callback(hostCtx);
    },
    get(service) {
      return Object.hasOwn(services, service) ? services[service] : null;
    },
    disposeAll() {
      const pendingEffects = effects.splice(0);
      for (const disposer of pendingEffects) {
        try {
          if (typeof disposer === 'function') disposer();
        } catch (error) {
          /* ignore */
        }
      }
    },
  };
  return root;
}

/* ------------------------------------------------------------------ */
/* Plugin contract                                                     */
/* ------------------------------------------------------------------ */

test('plugin contract: name, inject=[], apply and default export', () => {
  assert.equal(pluginName, 'dsh-bingo');
  assert.deepEqual(inject, []);
  assert.equal(typeof apply, 'function');
  assert.equal(plugin.name, 'dsh-bingo');
  assert.deepEqual(plugin.inject, []);
  assert.equal(plugin.apply, apply);
});

test('normalizeConfig clamps and defaults', () => {
  const defaults = normalizeConfig(undefined);
  assert.deepEqual(defaults, {
    enabled: true,
    pollMs: 4000,
    confirm: true,
    allowRestart: true,
    position: 'bottom-left',
    debug: false,
  });
  assert.equal(normalizeConfig({ pollMs: 1 }).pollMs, 1500);
  assert.equal(normalizeConfig({ pollMs: 999999 }).pollMs, 60000);
  assert.equal(normalizeConfig({ pollMs: 'abc' }).pollMs, 4000);
  assert.equal(normalizeConfig({ enabled: false }).enabled, false);
  assert.equal(normalizeConfig({ confirm: false }).confirm, false);
  assert.equal(normalizeConfig({ allowRestart: false }).allowRestart, false);
  assert.equal(normalizeConfig({ position: 'bottom-right' }).position, 'bottom-right');
  assert.equal(normalizeConfig({ position: 'top' }).position, 'bottom-left');
  assert.equal(normalizeConfig({ debug: true }).debug, true);
});

test('isDesktopHost requires electron + the desktop-host entry argv', () => {
  const versions = { electron: '35.0.0', node: '22.0.0' };
  assert.equal(isDesktopHost('C:/app/runtime/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js', versions), true);
  assert.equal(isDesktopHost('C:\\app\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js', versions), true);
  assert.equal(isDesktopHost('C:/app/node_modules/@deepseek-ai/dsh-web-app/lib/index.js', versions), false);
  assert.equal(isDesktopHost('C:/app/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js', { node: '22.0.0' }), false);
  assert.equal(isDesktopHost('', versions), false);
  assert.equal(isDesktopHost(undefined, undefined), false);
});

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

test('computeSignature is stable, sorted, and covers dependencies + bundles', () => {
  const a = { dependencies: { 'dsh-a': '1.0.0', 'dsh-b': '2.0.0' }, dsh: { profile: { bundles: ['dsh-a'] } } };
  const b = { dependencies: { 'dsh-b': '2.0.0', 'dsh-a': '1.0.0' }, dsh: { profile: { bundles: ['dsh-a'] } } };
  assert.equal(computeSignature(a), computeSignature(b));
  assert.ok(computeSignature(a).startsWith('sha256:'));
  assert.notEqual(computeSignature(a), computeSignature({ dependencies: { 'dsh-a': '1.0.1' }, dsh: a.dsh }));
  assert.notEqual(computeSignature(a), computeSignature({ dependencies: a.dependencies, dsh: { profile: { bundles: ['dsh-a', 'dsh-c'] } } }));
  assert.equal(computeSignature({}), computeSignature({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
});

test('listPackages and snapshotPackages include bundle-only entries', () => {
  const manifest = { dependencies: { 'dsh-z': '1.0.0', 'dsh-a': '2.0.0' }, dsh: { profile: { bundles: ['dsh-a', 'dsh-bundle'] } } };
  assert.deepEqual(listPackages(manifest), [
    { name: 'dsh-a', version: '2.0.0' },
    { name: 'dsh-bundle', version: null },
    { name: 'dsh-z', version: '1.0.0' },
  ]);
  const snapshot = snapshotPackages(manifest);
  assert.equal(snapshot.signature, computeSignature(manifest));
  assert.deepEqual(snapshot.packages, listPackages(manifest));
});

test('diffPackages reports only additions and returns null without change', () => {
  const baseline = snapshotPackages({ dependencies: { 'dsh-a': '1.0.0' }, dsh: { profile: { bundles: [] } } });
  assert.equal(diffPackages(null, baseline), null);
  assert.equal(diffPackages(baseline, baseline), null);
  const current = snapshotPackages({ dependencies: { 'dsh-a': '1.0.0', 'dsh-new': '2.0.0' }, dsh: { profile: { bundles: ['dsh-new', 'dsh-only-bundle'] } } });
  const diff = diffPackages(baseline, current);
  assert.equal(diff.signature, current.signature);
  assert.deepEqual(diff.packages, [
    { name: 'dsh-new', version: '2.0.0' },
    { name: 'dsh-only-bundle', version: null },
  ]);
});

test('resolveProfileDir prefers host profile services over the inherited env', () => {
  const serviceCtx = { get(service) { return service === 'profileContext' ? { dir: 'C:/service/profile', name: 'svc' } : null; } };
  // The desktop shell may export a DSH_PROFILE_DIR for a different profile than
  // the one actually hosting us (self-test profiles); the service wins.
  assert.equal(
    resolveProfileDir({ DSH_PROFILE_DIR: 'C:/inherited/desktop/profile' }, serviceCtx),
    path.resolve('C:/service/profile'),
  );
  assert.equal(
    resolveProfileDir({ DSH_PROFILE_DIR: 'C:/explicit/profile' }, null),
    path.resolve('C:/explicit/profile'),
  );
  const desktopCtx = { get(service) { return service === 'desktopProfiles' ? { current: { dir: 'C:/desk/profile' } } : null; } };
  assert.equal(resolveProfileDir({}, desktopCtx), path.resolve('C:/desk/profile'));
  assert.equal(
    resolveProfileDir({ DSH_HOME: 'C:/dshhome', DSH_PROFILE: 'bingo' }, null),
    path.join(path.resolve('C:/dshhome'), 'profiles', 'bingo'),
  );
  assert.equal(
    resolveProfileDir({}, null),
    path.join(os.homedir(), '.dsh', 'profiles', 'desktop'),
  );
});

test('resolveStateDir honors DSH_BINGO_HOME and DSH_HOME', () => {
  assert.equal(resolveStateDir({ DSH_BINGO_HOME: 'C:/bingo-home', DSH_HOME: 'C:/dsh' }), path.resolve('C:/bingo-home'));
  assert.equal(resolveStateDir({ DSH_HOME: 'C:/dsh' }), path.join(path.resolve('C:/dsh'), 'bingo'));
  assert.equal(resolveStateDir({}), path.join(os.homedir(), '.dsh', 'bingo'));
});

/* ------------------------------------------------------------------ */
/* Trust fence                                                         */
/* ------------------------------------------------------------------ */

test('isLoopbackHostname accepts only loopback authorities', () => {
  for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', 'app.localhost', '::1', '[::1]']) {
    assert.equal(isLoopbackHostname(host), true, host);
  }
  for (const host of ['', '10.0.0.1', '192.168.1.2', '127.0.0.1.evil.com', 'localhost.evil.com', '0.0.0.0', '::2']) {
    assert.equal(isLoopbackHostname(host), false, host);
  }
});

test('buildFence: loopback, same-origin, cross-site and delegation order', () => {
  const fence = buildFence(null);
  assert.equal(fence({ headers: {} }), 403);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080' } }), null);
  assert.equal(fence({ headers: { host: 'localhost:8080' } }), null);
  assert.equal(fence({ headers: { host: '[::1]:8080' } }), null);
  assert.equal(fence({ headers: { host: '127.0.0.1.evil.com:8080' } }), 403);
  assert.equal(fence({ headers: { host: '10.0.0.5:8080' } }), 403);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'cross-site' } }), 403);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080', 'sec-fetch-site': 'same-origin' } }), null);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080', origin: 'http://evil.example.com' } }), 403);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080' } }), null);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080', origin: 'null' } }), null);
  assert.equal(fence({ headers: { host: '127.0.0.1:8080', origin: 'not a url' } }), 403);

  let delegated = 0;
  const delegateFence = buildFence({
    requestRejection() {
      delegated += 1;
      return 401;
    },
  });
  assert.equal(delegateFence({ headers: { host: '127.0.0.1:8080' } }), 401);
  assert.equal(delegated, 1);
  assert.equal(
    buildFence({ requestRejection() { return null; } })({ headers: { host: '10.0.0.5:8080' } }),
    null,
  );
  assert.equal(
    buildFence({ requestRejection() { throw new Error('boom'); } })({ headers: { host: '127.0.0.1:8080' } }),
    403,
  );
  assert.equal(
    buildFence({ requestRejection() { return 'weird'; } })({ headers: { host: '127.0.0.1:8080' } }),
    403,
  );
  assert.equal(
    buildFence({ requestRejection() { return 0; } })({ headers: { host: '127.0.0.1:8080' } }),
    403,
  );
});

/* ------------------------------------------------------------------ */
/* Injection rows                                                      */
/* ------------------------------------------------------------------ */

test('buildInjectRow is an inline script loader that swallows errors', () => {
  const row = buildInjectRow('0.1.0');
  assert.equal(row.kind, 'script');
  assert.equal(row.placement, 'body');
  assert.equal(row.src, undefined);
  assert.ok(row.text.includes('/bingo/client.js?v=0.1.0'));
  assert.ok(row.text.includes('onerror=function(){}'));
  assert.ok(row.text.startsWith('(function(){try{'));
  assert.equal(row.text.includes('script-src'), false);
  assert.equal(buildInjectText('a b'), buildInjectText('a b'));
  assert.ok(buildInjectText('a b').includes('a%20b'));
});

test('pushInjectionRows dedupes both the loader and the position global', () => {
  const table = [];
  assert.equal(pushInjectionRows(table, '9.9.9', 'bottom-right'), true);
  assert.equal(table.length, 2);
  const script = table.find((row) => row.kind === 'script');
  const globalRow = table.find((row) => row.kind === 'global');
  assert.ok(script && script.text.includes('/bingo/client.js?v=9.9.9'));
  assert.deepEqual(globalRow, { kind: 'global', name: '__DSH_BINGO_POSITION__', value: 'bottom-right' });
  assert.equal(pushInjectionRows(table, '9.9.9', 'bottom-right'), false);
  assert.equal(table.length, 2);

  const preexisting = [{ kind: 'script', placement: 'body', text: 'load("/bingo/client.js")' }];
  assert.equal(pushInjectionRows(preexisting, '9.9.9', 'bottom-left'), true);
  assert.equal(preexisting.length, 2);
  assert.equal(preexisting.filter((row) => row.kind === 'script').length, 1);

  const withGlobal = [{ kind: 'global', name: '__DSH_BINGO_POSITION__', value: 'bottom-left' }];
  pushInjectionRows(withGlobal, '9.9.9', 'bottom-left');
  assert.equal(withGlobal.filter((row) => row.kind === 'global').length, 1);
});

test('apply registers the injection listener synchronously before waiting for services', (t) => {
  withTempEnv((envInfo) => {
    const webServer = createFakeWebServer();
    const root = createRootContext(webServer);
    apply(root, { position: 'bottom-right' });
    t.after(() => {
      root.disposeAll();
      fs.rmSync(envInfo.dir, { recursive: true, force: true });
    });

    const kinds = root.calls.map((call) => call.type);
    assert.equal(kinds[0], 'on');
    assert.equal(root.calls[0].event, 'webserver/index-inject');
    assert.ok(kinds.indexOf('inject') > kinds.indexOf('on'));
    const injectCall = root.calls.find((call) => call.type === 'inject');
    assert.deepEqual(injectCall.dependencies, ['webServer']);

    const table = [];
    root.emit('webserver/index-inject', table);
    assert.equal(table.length, 2);
    assert.ok(table.some((row) => row.kind === 'script' && row.text.includes('/bingo/client.js')));
    assert.ok(table.some((row) => row.kind === 'global' && row.value === 'bottom-right'));

    // web shape: tapIndex fallback inserts the client exactly once.
    assert.equal(webServer.taps.length, 1);
    const tap = webServer.taps[0];
    const transformed = tap('<html><body><div>app</div></body></html>');
    assert.ok(transformed.includes('<script defer src="/bingo/client.js?v='));
    assert.equal(tap(transformed), transformed);
    assert.ok(tap('<html><body></body></html>').includes('/bingo/client.js'));

    // Routes are live on the fake webServer.
    assert.ok(webServer.routes.has('/bingo/status'));
    assert.ok(webServer.routes.has('/bingo'));
  });
});

test('apply with enabled:false registers nothing', (t) => {
  const dir = makeTempDir('disabled');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const webServer = createFakeWebServer();
  const root = createRootContext(webServer);
  apply(root, { enabled: false });
  assert.equal(root.calls.length, 0);
  assert.equal(webServer.routes.size, 0);
  root.disposeAll();
});

/* ------------------------------------------------------------------ */
/* Runtime: status + routes                                            */
/* ------------------------------------------------------------------ */

test('GET /bingo/status reports profile, capabilities and pending=null', async (t) => {
  const ctx = setupRuntime({ desktop: false });
  cleanup(ctx, t);
  const response = await callRoute(ctx.runtime, '/bingo/status');
  assert.equal(response.status, 200);
  assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const status = response.json();
  assert.equal(status.ok, true);
  assert.equal(status.version, '9.9.9');
  assert.equal(status.desktop, false);
  assert.equal(status.canRestart, false);
  assert.equal(status.restarting, false);
  assert.equal(status.pollMs, 4000);
  assert.equal(status.position, 'bottom-left');
  assert.equal(status.confirm, true);
  assert.deepEqual(status.profile, { name: 'test-profile', dir: ctx.profileDir });
  assert.equal(status.pending, null);
  assert.equal(status.lastRestart, null);
});

test('runtime adopts a late profileContext over the inherited DSH_PROFILE_DIR', async (t) => {
  const dir = makeTempDir('late-profile');
  const inherited = path.join(dir, 'inherited-desktop-profile');
  const actual = path.join(dir, 'actual-selftest-profile');
  writeProfile(inherited, { dependencies: { 'dsh-inherited': '1.0.0' }, dsh: { profile: { bundles: ['dsh-inherited'] } } });
  writeProfile(actual, { dependencies: { 'dsh-actual': '2.0.0' }, dsh: { profile: { bundles: ['dsh-actual'] } } });
  const stateDir = path.join(dir, 'bingo');
  fs.mkdirSync(stateDir, { recursive: true });
  const webServer = createFakeWebServer();
  const hostCtx = createHostContext({ webServer });
  const services = { webServer, connection: null };
  hostCtx.get = (service) => (Object.hasOwn(services, service) ? services[service] : null);
  const runtime = createRuntime(hostCtx, { pollMs: 60000 }, {
    env: { DSH_BINGO_HOME: stateDir, DSH_HOME: dir, DSH_PROFILE_DIR: inherited },
    stateDir,
    settleMs: 0,
    isDesktop: false,
    version: '9.9.9',
    clientDir: path.join(dir, 'client'),
  });
  t.after(() => {
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // At apply time no profile service is visible: the env fallback is used.
  assert.equal(runtime.status().profile.dir, path.resolve(inherited));

  // The host service appears afterwards (Cordis mounts it later); it is the
  // authority and the baseline is re-installed from that profile.
  services.profileContext = { name: 'bingo-selftest', dir: actual };
  const status = runtime.status();
  assert.equal(status.profile.dir, path.resolve(actual));
  assert.equal(status.profile.name, 'bingo-selftest');
  assert.equal(status.pending, null, 'the actual profile baseline is adopted silently');

  // Detection now watches the actual profile.
  writeProfile(actual, {
    dependencies: { 'dsh-actual': '2.0.0', 'dsh-late': '3.0.0' },
    dsh: { profile: { bundles: ['dsh-actual', 'dsh-late'] } },
  });
  await runtime.detectNow();
  assert.deepEqual(runtime.status().pending.packages, [{ name: 'dsh-late', version: '3.0.0' }]);
});

test('routes enforce the trust fence before dispatch', async (t) => {
  const allowed = { requestRejection() { return null; } };
  const ctx = setupRuntime({ desktop: false, connection: allowed });
  cleanup(ctx, t);

  const crossSite = await callRoute(ctx.runtime, '/bingo/status', {
    headers: { host: '127.0.0.1:4321', 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.status, 403);
  assert.deepEqual(crossSite.json(), { ok: false });

  const badOrigin = await callRoute(ctx.runtime, '/bingo/status', {
    headers: { host: '127.0.0.1:4321', origin: 'http://evil.example.com' },
  });
  assert.equal(badOrigin.status, 403);

  const sameOrigin = await callRoute(ctx.runtime, '/bingo/status', {
    headers: { host: '127.0.0.1:4321', origin: 'http://127.0.0.1:4321' },
  });
  assert.equal(sameOrigin.status, 200);

  // With a host fence available, a non-loopback Host is delegated to it (the
  // host knows its own --trusted-host list); the delegate allows this one.
  const delegatedHost = await callRoute(ctx.runtime, '/bingo/status', { headers: { host: 'harness.example.com' } });
  assert.equal(delegatedHost.status, 200);

  // Without the host fence, a non-loopback Host is rejected by our own fence.
  const noFence = setupRuntime({ desktop: false, connection: null });
  t.after(() => {
    noFence.runtime.dispose();
    fs.rmSync(noFence.dir, { recursive: true, force: true });
  });
  const publicHost = await callRoute(noFence.runtime, '/bingo/status', { headers: { host: 'evil.example.com' } });
  assert.equal(publicHost.status, 403);

  const rejectedCtx = setupRuntime({ desktop: false, connection: { requestRejection() { return 401; } } });
  t.after(() => {
    rejectedCtx.runtime.dispose();
    fs.rmSync(rejectedCtx.dir, { recursive: true, force: true });
  });
  const rejected = await callRoute(rejectedCtx.runtime, '/bingo/status', { headers: { host: '127.0.0.1:4321' } });
  assert.equal(rejected.status, 401);
  assert.deepEqual(rejected.json(), { ok: false });

  const throwing = setupRuntime({ desktop: false, connection: { requestRejection() { throw new Error('nope'); } } });
  t.after(() => {
    throwing.runtime.dispose();
    fs.rmSync(throwing.dir, { recursive: true, force: true });
  });
  const thrown = await callRoute(throwing.runtime, '/bingo/status', { headers: { host: '127.0.0.1:4321' } });
  assert.equal(thrown.status, 403);
});

test('method and JSON body validation', async (t) => {
  const ctx = setupRuntime({ desktop: true });
  cleanup(ctx, t);

  const wrongMethod = await callRoute(ctx.runtime, '/bingo/status', { method: 'POST' });
  assert.equal(wrongMethod.status, 405);

  const badJson = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST', body: '{oops' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json().code, 'invalid-json');

  const arrayBody = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST', body: '[1,2]' });
  assert.equal(arrayBody.status, 400);

  const tooLarge = await callRoute(ctx.runtime, '/bingo/restart', {
    method: 'POST',
    body: '{"trigger":"' + 'x'.repeat(5000) + '"}',
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.json().code, 'body-too-large');

  const emptyBody = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST' });
  assert.equal(emptyBody.status, 202);
  assert.equal(ctx.spawnCalls.length, 1);
});

test('unknown /bingo/* stays inside the plugin and answers 404 JSON', async (t) => {
  const ctx = setupRuntime({ desktop: false });
  cleanup(ctx, t);
  const prefix = ctx.runtime.routes.get('/bingo');
  assert.ok(prefix);
  assert.equal(prefix.kind, 'prefix');
  const response = await callRoute(ctx.runtime, '/bingo');
  assert.equal(response.status, 404);
  assert.equal(response.json().code, 'not-found');
});

test('client.js / client.css are served with mtime caching and no-store', async (t) => {
  const ctx = setupRuntime({ desktop: false });
  cleanup(ctx, t);
  const clientDir = path.join(ctx.dir, 'client');
  fs.mkdirSync(clientDir, { recursive: true });

  fs.writeFileSync(path.join(clientDir, 'bingo-client.js'), 'window.__v1=1;', 'utf8');
  fs.writeFileSync(path.join(clientDir, 'bingo-client.css'), '.v1{}', 'utf8');

  const js1 = await callRoute(ctx.runtime, '/bingo/client.js');
  assert.equal(js1.status, 200);
  assert.ok(js1.headers['Content-Type'].includes('application/javascript'));
  assert.equal(js1.headers['Cache-Control'], 'no-store');
  assert.equal(js1.body, 'window.__v1=1;');

  const css1 = await callRoute(ctx.runtime, '/bingo/client.css');
  assert.equal(css1.status, 200);
  assert.ok(css1.headers['Content-Type'].includes('text/css'));
  assert.equal(css1.body, '.v1{}');

  const jsPath = path.join(clientDir, 'bingo-client.js');
  fs.writeFileSync(jsPath, 'window.__v2=2;', 'utf8');
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(jsPath, future, future);
  const js2 = await callRoute(ctx.runtime, '/bingo/client.js');
  assert.equal(js2.body, 'window.__v2=2;');

  fs.rmSync(jsPath);
  const missing = await callRoute(ctx.runtime, '/bingo/client.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.json().code, 'not-found');
});

test('dispose removes routes and tap', async (t) => {
  const ctx = setupRuntime({ desktop: false });
  const dir = ctx.dir;
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.ok(ctx.webServer.routes.size > 0);
  assert.equal(ctx.webServer.taps.length, 1);
  ctx.runtime.dispose();
  assert.equal(ctx.webServer.routes.size, 0);
  assert.equal(ctx.webServer.taps.length, 0);
  assert.equal(ctx.runtime.routes.size, 0);
});

/* ------------------------------------------------------------------ */
/* Runtime: detection                                                  */
/* ------------------------------------------------------------------ */

test('detection: baseline refresh, pending, dismiss/ack, bundle-only change', async (t) => {
  const initial = { dependencies: { 'dsh-a': '1.0.0' }, dsh: { profile: { bundles: ['dsh-a'] } } };
  const ctx = setupRuntime({ desktop: false, packageJson: initial });
  cleanup(ctx, t);

  // Plugins installed before startup never trigger a prompt.
  assert.equal(ctx.runtime.status().pending, null);

  const withNew = {
    dependencies: { 'dsh-a': '1.0.0', 'dsh-new': '2.0.0' },
    dsh: { profile: { bundles: ['dsh-a', 'dsh-new'] } },
  };
  writeProfile(ctx.profileDir, withNew);
  await ctx.runtime.detectNow();
  const pending = ctx.runtime.status().pending;
  assert.ok(pending);
  assert.ok(pending.signature.startsWith('sha256:'));
  assert.deepEqual(pending.packages, [{ name: 'dsh-new', version: '2.0.0' }]);
  assert.ok(typeof pending.detectedAt === 'string');
  assert.ok(!Number.isNaN(Date.parse(pending.detectedAt)));

  const statusResponse = await callRoute(ctx.runtime, '/bingo/status');
  assert.deepEqual(statusResponse.json().pending.packages, [{ name: 'dsh-new', version: '2.0.0' }]);

  // Wrong signature must not acknowledge.
  const wrong = await callRoute(ctx.runtime, '/bingo/dismiss', { method: 'POST', body: JSON.stringify({ signature: 'sha256:wrong' }) });
  assert.equal(wrong.status, 409);
  assert.deepEqual(wrong.json(), { ok: false, code: 'no-pending' });
  assert.ok(ctx.runtime.status().pending);

  const ack = await callRoute(ctx.runtime, '/bingo/dismiss', {
    method: 'POST',
    body: JSON.stringify({ signature: pending.signature }),
  });
  assert.equal(ack.status, 200);
  assert.deepEqual(ack.json(), { ok: true });
  assert.equal(ctx.runtime.status().pending, null);

  // Nothing pending: a dismiss can no longer match, and the contract says so.
  const noPending = await callRoute(ctx.runtime, '/bingo/dismiss', {
    method: 'POST',
    body: JSON.stringify({ signature: pending.signature }),
  });
  assert.equal(noPending.status, 409);
  assert.deepEqual(noPending.json(), { ok: false, code: 'no-pending' });
  const persisted = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, 'state.json'), 'utf8'));
  assert.equal(persisted.acknowledgedSignature, pending.signature);

  // Same signature is never reported again.
  await ctx.runtime.detectNow();
  assert.equal(ctx.runtime.status().pending, null);

  // A later plugin prompts again, and only the new one is listed.
  writeProfile(ctx.profileDir, {
    dependencies: { 'dsh-a': '1.0.0', 'dsh-new': '2.0.0', 'dsh-later': '3.0.0' },
    dsh: { profile: { bundles: ['dsh-a', 'dsh-new', 'dsh-later'] } },
  });
  await ctx.runtime.detectNow();
  assert.deepEqual(ctx.runtime.status().pending.packages, [{ name: 'dsh-later', version: '3.0.0' }]);
  await ctx.runtime.dismiss(ctx.runtime.status().pending.signature);

  // Bundle-only change is detected too (no dependency entry).
  writeProfile(ctx.profileDir, {
    dependencies: { 'dsh-a': '1.0.0', 'dsh-new': '2.0.0', 'dsh-later': '3.0.0' },
    dsh: { profile: { bundles: ['dsh-a', 'dsh-new', 'dsh-later', 'dsh-bundle-only'] } },
  });
  await ctx.runtime.detectNow();
  assert.deepEqual(ctx.runtime.status().pending.packages, [{ name: 'dsh-bundle-only', version: null }]);
});

test('detection: version-only change advances the baseline silently', async (t) => {
  const ctx = setupRuntime({
    desktop: false,
    packageJson: { dependencies: { 'dsh-a': '1.0.0' }, dsh: { profile: { bundles: ['dsh-a'] } } },
  });
  cleanup(ctx, t);
  writeProfile(ctx.profileDir, { dependencies: { 'dsh-a': '1.0.1' }, dsh: { profile: { bundles: ['dsh-a'] } } });
  await ctx.runtime.detectNow();
  assert.equal(ctx.runtime.status().pending, null);
  const persisted = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, 'state.json'), 'utf8'));
  assert.equal(persisted.baselineSignature, computeSignature({ dependencies: { 'dsh-a': '1.0.1' }, dsh: { profile: { bundles: ['dsh-a'] } } }));
});

test('lastRestart is reconciled from the helper log tail', async (t) => {
  const attemptAt = '2026-01-01T00:00:00.000Z';
  const ctx = setupRuntime({
    desktop: false,
    state: {
      baselineSignature: null,
      baselinePackages: [],
      acknowledgedSignature: null,
      lastRestart: { at: attemptAt, trigger: 'button', ok: true },
    },
    logText: '[' + attemptAt + '] start helper' + NL + '[2026-01-01T00:00:09.000Z] done failed replacement could not be started' + NL,
  });
  cleanup(ctx, t);
  const lastRestart = ctx.runtime.status().lastRestart;
  assert.equal(lastRestart.ok, false);
  assert.equal(lastRestart.trigger, 'button');
  assert.equal(lastRestart.log, ctx.runtime.logPath);

  const stale = setupRuntime({
    desktop: false,
    state: {
      baselineSignature: null,
      baselinePackages: [],
      acknowledgedSignature: null,
      lastRestart: { at: attemptAt, trigger: 'button', ok: true },
    },
    logText: '[2025-12-31T23:59:59.000Z] done failed an older attempt' + NL,
  });
  t.after(() => {
    stale.runtime.dispose();
    fs.rmSync(stale.dir, { recursive: true, force: true });
  });
  assert.equal(stale.runtime.status().lastRestart.ok, true);
});

/* ------------------------------------------------------------------ */
/* Runtime: restart scheduling                                        */
/* ------------------------------------------------------------------ */

test('restart is unsupported without the desktop host', async (t) => {
  const ctx = setupRuntime({ desktop: false });
  cleanup(ctx, t);
  const response = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST', body: JSON.stringify({ trigger: 'button' }) });
  assert.equal(response.status, 409);
  assert.equal(response.json().code, 'unsupported');
  assert.equal(ctx.spawnCalls.length, 0);
  assert.equal(ctx.runtime.status().canRestart, false);
});

test('restart scheduling spawns a detached helper with a base64url config', async (t) => {
  const fixedNow = Date.parse('2026-02-03T04:05:06.000Z');
  const ctx = setupRuntime({ desktop: true, now: () => fixedNow });
  cleanup(ctx, t);

  const response = await callRoute(ctx.runtime, '/bingo/restart', {
    method: 'POST',
    body: JSON.stringify({ trigger: 'shortcut' }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(response.json(), { ok: true, scheduled: true });

  assert.equal(ctx.spawnCalls.length, 1);
  const call = ctx.spawnCalls[0];
  assert.equal(call.file, 'C:/fake/DeepSeek Harness.exe');
  assert.equal(call.args[0], '--expose-internals');
  assert.equal(call.args[1], 'C:/fake/lib/restart-helper.cjs');
  assert.equal(call.options.detached, true);
  assert.equal(call.options.stdio, 'ignore');
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(call.unrefCalled, true);

  const payload = JSON.parse(Buffer.from(call.args[2], 'base64url').toString('utf8'));
  assert.equal(payload.shellPid, 4242);
  assert.equal(payload.hostPid, 4343);
  assert.equal(payload.appExe, 'C:/fake/DeepSeek Harness.exe');
  assert.equal(payload.appDir, 'C:/fake');
  assert.equal(payload.port, 4321);
  assert.equal(payload.trigger, 'shortcut');
  assert.equal(payload.delayMs, 650);
  assert.equal(payload.logPath, path.join(ctx.stateDir, 'restart.log'));
  assert.equal(payload.testLaunch, undefined);

  const status = ctx.runtime.status();
  assert.equal(status.restarting, true);
  assert.equal(status.lastRestart.ok, true);
  assert.equal(status.lastRestart.trigger, 'shortcut');
  assert.equal(status.lastRestart.at, '2026-02-03T04:05:06.000Z');
  const persisted = JSON.parse(fs.readFileSync(path.join(ctx.stateDir, 'state.json'), 'utf8'));
  assert.equal(persisted.lastRestart.trigger, 'shortcut');

  const duplicate = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json().code, 'restarting');
  assert.equal(ctx.spawnCalls.length, 1);
});

test('restart respects allowRestart:false even on desktop', async (t) => {
  const ctx = setupRuntime({ desktop: true, config: { allowRestart: false } });
  cleanup(ctx, t);
  assert.equal(ctx.runtime.status().canRestart, false);
  const response = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal(response.json().code, 'unsupported');
  assert.equal(ctx.spawnCalls.length, 0);
});

test('restart spawn failure resets state and answers 500 spawn-failed', async (t) => {
  const ctx = setupRuntime({ desktop: true, spawnThrows: true });
  cleanup(ctx, t);
  const response = await callRoute(ctx.runtime, '/bingo/restart', { method: 'POST' });
  assert.equal(response.status, 500);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'spawn-failed');
  assert.equal(ctx.runtime.status().restarting, false);
  assert.equal(ctx.runtime.status().lastRestart.ok, false);
});

test('buildHelperConfig validates PIDs and carries testLaunch only when asked', () => {
  const cfg = buildHelperConfig({
    shellPid: '42',
    hostPid: 43,
    appExe: 'C:/app.exe',
    appDir: 'C:/',
    port: 'not-a-port',
    logPath: 'C:/log/restart.log',
    trigger: '',
    delayMs: 'oops',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(cfg.shellPid, 42);
  assert.equal(cfg.hostPid, 43);
  assert.equal(cfg.port, null);
  assert.equal(cfg.trigger, 'button');
  assert.equal(cfg.delayMs, 650);
  assert.equal(cfg.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(cfg.testLaunch, undefined);

  const withLaunch = buildHelperConfig({
    shellPid: 1,
    hostPid: 2,
    appExe: 'a',
    appDir: 'b',
    port: 8080,
    logPath: 'c',
    testLaunch: { file: 'node', args: ['fixture.cjs', 7] },
  });
  assert.deepEqual(withLaunch.testLaunch, { file: 'node', args: ['fixture.cjs', '7'] });
  assert.equal(withLaunch.port, 8080);
});

test('spawnRestartHelper rejects a missing config', () => {
  assert.throws(() => spawnRestartHelper({ cfg: null }), /missing restart helper config/);
});