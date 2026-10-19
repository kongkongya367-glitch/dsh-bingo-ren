import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../preview/src/bingo-client.js', import.meta.url), 'utf8');
const entry = '  if (document.body) boot();';
assert.ok(source.includes(entry));

function client(fetchStatus) {
  let timerId = 0;
  const timers = new Map();
  const window = {
    innerWidth: 1200, innerHeight: 800,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  const sandbox = vm.createContext({
    window, document: { hidden: false },
    fetch: async () => ({ ok: true, json: fetchStatus }),
  });
  vm.runInContext(source.replace(entry,
    '  window.testClient = { S:S, els:els, poll:pollOnce, enter:enterRestarting, error:handleRestartError, setRoot:function(value){root=value;} }; return;\n' + entry), sandbox);
  const c = window.testClient;
  const node = () => ({
    hidden: true, style: {}, dataset: {}, setAttribute() {}, removeAttribute() {}, focus() {},
    getBoundingClientRect: () => ({ left: 20, top: 600, right: 120, bottom: 644, width: 100, height: 44 }),
  });
  for (const name of ['restartLayer', 'restartCard', 'panel', 'pill', 'close', 'error', 'live', 'dialogLayer',
    'version', 'status', 'statusDot', 'pending', 'primary', 'primaryLabel', 'later', 'refresh', 'note', 'meta']) c.els[name] = node();
  c.S.emitted = true;
  return { ...c, timers, node };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const failed = () => ({ ok: true, canRestart: true, desktop: true, restarting: false, pending: null, lastRestart: { ok: false } });

test('a failed restart clears the overlay and opens an error panel', async () => {
  const c = client(async () => failed());
  c.enter();
  const manualTimer = c.S.manualTimer;
  assert.equal(c.els.restartLayer.hidden, false);
  c.poll(true);
  await flush();
  assert.equal(c.S.restarting, false);
  assert.equal(c.els.restartLayer.hidden, true);
  assert.equal(c.els.panel.hidden, false);
  assert.equal(c.els.error.hidden, false);
  assert.match(c.els.error.textContent, /重启未完成/);
  assert.equal(c.timers.has(manualTimer), false);
});

test('a status request from before restart cannot dismiss its overlay', async () => {
  let resolveStatus;
  const c = client(() => new Promise(resolve => { resolveStatus = resolve; }));
  c.poll(true);
  await flush();
  c.enter();
  resolveStatus(failed());
  await flush();
  assert.equal(c.S.restarting, true);
  assert.equal(c.els.restartLayer.hidden, false);
  c.poll(true);
  await flush();
  resolveStatus(failed());
  await flush();
  assert.equal(c.S.restarting, false);
});

test('restart errors from the new-plugin dialog are shown in the panel', () => {
  const c = client(async () => failed());
  c.setRoot(c.node());
  c.S.dialog = true;
  c.error({ data: { code: 'spawn-failed' } });
  assert.equal(c.S.dialog, false);
  assert.equal(c.els.dialogLayer.hidden, true);
  assert.equal(c.els.panel.hidden, false);
  assert.equal(c.els.error.hidden, false);
  assert.match(c.els.error.textContent, /重启进程启动失败/);
});
