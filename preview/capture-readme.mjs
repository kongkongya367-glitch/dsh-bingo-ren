// Capture current UI directly in an isolated browser. No image compositing,
// image generation, real Harness profile, or real plugin changes are involved.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const edge = process.env.BINGO_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
if (!fs.existsSync(edge)) throw new Error('Set BINGO_EDGE to a Chromium/Edge executable');
const scratch = path.join(root, '.tmp'); fs.mkdirSync(scratch, { recursive: true });
const dir = fs.mkdtempSync(path.join(scratch, 'readme-capture-'));
const output = path.join(root, 'assets');
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=' + dir, '--allow-file-access-from-files', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(80); }
  throw new Error('Timed out: ' + label);
}
let socket; let nextId = 0;
const pending = new Map();
const exceptions = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 10000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
const shadow = "document.getElementById('dsh-bingo-host').shadowRoot";
async function capture(scene, name, elements, drag = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'preview/index.html')).href + '?scene=' + scene });
  await until(() => evaluate('Boolean(window.__DSH_BINGO__ && document.getElementById("dsh-bingo-host"))').catch(() => false), 'client');
  await until(() => evaluate('Boolean('+shadow+'.querySelector("[data-visible=true]"))').catch(() => false), 'visible client');
  const first = elements[0];
  await until(() => evaluate('!'+shadow+'.querySelector('+JSON.stringify('[data-el='+first+']')+').hidden').catch(() => false), scene);
  if (first === 'desk') await until(() => evaluate('Boolean('+shadow+'.querySelector(".bingo-record"))'), 'manager data');
  if (drag) {
    const button = await evaluate('(()=>{const r='+shadow+'.querySelector("[data-el=pill]").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...button, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1070, y: 45, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1070, y: 45, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
    await evaluate(shadow+'.querySelector("[data-el=pill]").click()');
    await until(() => evaluate('!'+shadow+'.querySelector("[data-el=panel]").hidden'), 'dragged panel');
  }
  await evaluate("document.querySelector('.app').style.visibility='hidden'");
  // Hide the context page; retain the actual component styles and state.
  await sleep(300);
  await evaluate('document.fonts.ready');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const clip = await evaluate('(()=>{const boxes='+JSON.stringify(elements)+'.map(key=>'+shadow+'.querySelector(`[data-el=${key}]`).getBoundingClientRect());const x=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.left))-24)),y=Math.max(0,Math.floor(Math.min(...boxes.map(b=>b.top))-24));return {x,y,width:Math.ceil(Math.min(innerWidth,Math.max(...boxes.map(b=>b.right))+24)-x),height:Math.ceil(Math.min(innerHeight,Math.max(...boxes.map(b=>b.bottom))+24)-y),scale:1}})()');
  // Preserve the viewport: resizing it for a beyond-viewport capture would
  // move fixed-position components while taking their close-up.
  const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip });
  fs.writeFileSync(path.join(output, name), Buffer.from(result.data, 'base64'));
  console.log('Captured ' + name + ' (' + clip.width + ' × ' + clip.height + ' CSS px)');
}
try {
  await until(() => fs.existsSync(path.join(dir, 'DevToolsActivePort')), 'browser port');
  const port = Number(fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
  const targets = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    const call = pending.get(message.id);
    if (call) { pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }
  };
  await send('Page.enable'); await send('Runtime.enable');
  if (!process.argv.includes('--cover-only')) {
  await capture('button', 'screenshot-button.png', ['pill']);
  await capture('panel', 'screenshot-panel.png', ['panel','pill']);
  await capture('pending', 'screenshot-new-plugin.png', ['dialog']);
  await capture('panel&theme=dark', 'screenshot-panel-dark.png', ['panel','pill']);
  await capture('history', 'screenshot-history.png', ['desk']);
  await capture('overview', 'screenshot-overview.png', ['desk']);
  await capture('plugins', 'screenshot-plugins.png', ['desk']);
  await capture('trials', 'screenshot-trials.png', ['desk']);
  await capture('recovery', 'screenshot-recovery.png', ['desk']);
  await capture('cleanup-isolated', 'screenshot-cleanup.png', ['desk']);
  await capture('health', 'screenshot-health.png', ['desk']);
  await capture('checks&theme=dark', 'screenshot-checks.png', ['desk']);
  await capture('panel', 'screenshot-dragged.png', ['panel','pill'], true);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 620, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'preview/readme-cover.html')).href });
  await until(() => evaluate('document.readyState === "complete" && Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)'), 'cover images');
  await evaluate('document.fonts.ready');
  const cover = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, 'readme-hero.png'), Buffer.from(cover.data, 'base64'));
  if (exceptions.length) throw new Error(exceptions.join('\n'));
  console.log('Captured readme-hero.png; all previews use actual client UI and mock data.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch {} socket.close(); }
  await sleep(250);
  try { browser.kill(); } catch {}
}
