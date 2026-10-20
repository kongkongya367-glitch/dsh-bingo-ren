/**
 * Headless sanity check for every preview scene.
 * Opens each scene over HTTP, waits for the client to render, and asserts the
 * expected element is visible. Fails on any console error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const edge = process.env.BINGO_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!fs.existsSync(edge)) throw new Error('Set BINGO_EDGE to a Chromium/Edge executable');
const port = Number(process.env.BINGO_PREVIEW_PORT || 4173);
const base = 'http://127.0.0.1:' + port + '/preview/index.html';
const scratch = path.join(root, '.tmp'); fs.mkdirSync(scratch, { recursive: true });
const dir = fs.mkdtempSync(path.join(scratch, 'preview-check-'));
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + dir, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, ms = 15000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await sleep(80); }
  throw new Error('Timed out: ' + label);
}
let socket; let nextId = 0; const pending = new Map(); const errors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ' :: ' + expression.slice(0, 120));
  return response.result.value;
}
const shadow = "document.getElementById('dsh-bingo-host').shadowRoot";

const SCENES = [
  { scene: 'button', expect: 'pill' },
  { scene: 'panel', expect: 'panel' },
  { scene: 'pending', expect: 'dialog' },
  { scene: 'restarting', expect: 'restartCard' },
  { scene: 'history', expect: 'desk' },
  { scene: 'trials', expect: 'desk' },
  { scene: 'checks', expect: 'desk' },
  { scene: 'recovery', expect: 'desk' },
  { scene: 'recovery-safe', expect: 'desk' },
  { scene: 'recovery-legacy', expect: 'desk' },
  { scene: 'cleanup', expect: 'desk' },
  { scene: 'cleanup-isolated', expect: 'desk' },
  { scene: 'health', expect: 'desk' },
];

try {
  await until(() => fs.existsSync(path.join(dir, 'DevToolsActivePort')), 'browser port');
  const devPort = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const targets = await (await fetch('http://127.0.0.1:' + devPort + '/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description || ''));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });

  const results = [];
  for (const entry of SCENES) {
    errors.length = 0;
    await send('Page.navigate', { url: base + '?scene=' + entry.scene + '&dev=1' });
    await until(() => evaluate('Boolean(window.__DSH_BINGO__ && document.getElementById("dsh-bingo-host"))').catch(() => false), entry.scene + ' client');
    await until(() => evaluate('Boolean(' + shadow + ')').catch(() => false), entry.scene + ' shadow');
    const visible = await until(
      () => evaluate('(()=>{const n=' + shadow + '.querySelector(' + JSON.stringify('[data-el=' + entry.expect + ']') + ');return Boolean(n && !n.hidden && n.getBoundingClientRect().width>0)})()').catch(() => false),
      entry.scene + ' ' + entry.expect,
    ).then(() => true).catch(() => false);
    // Let fetches settle, then collect any error left behind.
    await sleep(400);
    const text = await evaluate('(' + shadow + '.textContent||"").slice(0,4000)');
    results.push({ scene: entry.scene, expect: entry.expect, visible, errors: [...errors], text: String(text).replace(/\s+/g, ' ').slice(0, 160) });
  }

  let failed = 0;
  for (const r of results) {
    const bad = !r.visible || r.errors.length;
    if (bad) failed++;
    console.log((bad ? 'FAIL ' : 'ok   ') + r.scene.padEnd(15) + ' [' + r.expect + '] ' + (r.errors.length ? 'ERR: ' + r.errors.join(' | ').slice(0, 200) : r.text));
  }
  console.log(failed ? failed + ' scene(s) failed' : 'all ' + results.length + ' scenes rendered');
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error('check failed: ' + error.message);
  process.exitCode = 1;
} finally {
  try { socket && socket.close(); } catch {}
  try { browser.kill(); } catch {}
  await sleep(200);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
