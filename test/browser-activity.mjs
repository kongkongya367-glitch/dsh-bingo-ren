// Optional real-browser check. Uses an isolated headless Edge profile and mock
// preview APIs; never connects to or modifies a real Harness profile.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const edge = process.env.BINGO_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!fs.existsSync(edge)) throw new Error('Set BINGO_EDGE to an installed Chromium/Edge executable');
const base = path.join(root, '.tmp'); fs.mkdirSync(base, { recursive: true });
const dir = fs.mkdtempSync(path.join(base, 'browser-activity-'));
const browser = spawn(edge, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + dir, '--allow-file-access-from-files', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) { if (await fn()) return; await sleep(80); }
  throw new Error('Timed out: ' + message);
}
let socket;
let id = 0;
const pending = new Map();
const errors = [];
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(key, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
}
const evaluate = async expression => {
  const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
};
const shadow = "document.querySelector('#dsh-bingo-host').shadowRoot";
const text = () => evaluate(shadow + ".querySelector('[data-el=deskContent]').textContent");
const clickText = label => evaluate("Array.from(" + shadow + ".querySelector('[data-el=deskContent]').querySelectorAll('button')).find(b=>b.textContent===" + JSON.stringify(label) + ").click()");
async function navigate(scene, width = 1200, height = 900) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const url = pathToFileURL(path.join(root, 'preview/index.html')).href + '?scene=' + scene;
  await command('Page.navigate', { url });
  await waitFor(() => evaluate("Boolean(window.__DSH_BINGO__ && !" + shadow + ".querySelector('[data-el=deskLayer]').hidden && " + shadow + ".querySelector('[data-el=deskContent] .bingo-record'))").catch(() => false), 'manager content');
}
async function shot(name) {
  await sleep(100);
  const png = await command('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(png.data, 'base64'));
}
try {
  await waitFor(() => fs.existsSync(path.join(dir, 'DevToolsActivePort')), 'Edge debug port');
  const port = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const call = pending.get(message.id);
    if (call) { pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
  };
  await command('Page.enable'); await command('Runtime.enable');
  await navigate('history');
  assert.match(await text(), /版本变更/); assert.match(await text(), /移除/);
  await shot('history');
  await evaluate(shadow + ".querySelector('[data-el=trialsTab]').click()");
  await clickText('标记试用');
  await waitFor(async () => (await text()).includes('试用中'), 'mark trial');
  await clickText('保留');
  await waitFor(async () => (await text()).includes('暂无试用'), 'keep trial');
  await clickText('标记试用');
  await waitFor(async () => (await text()).includes('试用中'), 'second trial');
  await clickText('移除');
  assert.match(await text(), /确认移除/);
  assert.equal(await evaluate(shadow + ".querySelector('select').options.length"), 3);
  await clickText('确认移除');
  await waitFor(async () => (await text()).includes('暂无试用'), 'confirmed removal');
  assert.equal(await evaluate(shadow + ".querySelector('select').options.length"), 2);
  await navigate('trials');
  assert.match(await text(), /待决定/);
  await shot('trials');
  await clickText('下次启动再问');
  await waitFor(async () => !(await text()).includes('待决定'), 'snooze');
  await navigate('checks&theme=dark');
  assert.match(await text(), /运行中/); assert.match(await text(), /加载失败/); assert.match(await text(), /无法确认/);
  await shot('checks-dark');
  await navigate('checks', 375, 700);
  const bounds = await evaluate("(()=>{const r=" + shadow + ".querySelector('[data-el=desk]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()");
  assert.ok(bounds.left >= 12 && bounds.right <= 363 && bounds.top >= 12 && bounds.bottom <= 688, JSON.stringify(bounds));
  await shot('checks-mobile');
  assert.deepEqual(errors, []);
  console.log('PASS real Edge: history, trial mark/keep/snooze/confirmed removal, acceptance, dark/mobile layout');
  console.log('Screenshots: ' + dir);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close'); } catch { /* page socket closes on shutdown */ }
    socket.close();
  }
  await sleep(300);
  try { browser.kill(); } catch { /* already exited */ }
}
