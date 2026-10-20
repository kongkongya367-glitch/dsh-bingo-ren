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
  await navigate('overview');
  assert.equal(await evaluate(shadow+".querySelectorAll('.bingo-tabs button').length"),4);
  assert.match(await text(), /先处理这几件事/);
  assert.equal(await evaluate("window.__BINGO_DEMO_REQUESTS__.some(r=>/recovery|health|timeline/.test(r.url))"),false);
  assert.equal(await evaluate("performance.getEntriesByType('resource').some(r=>r.name.includes('bingo-tools.js'))"),false);
  await clickText('生成排查摘要');
  assert.match(await evaluate(shadow+".querySelector('textarea').value"),/Bingo 排查摘要/);
  assert.doesNotMatch(await evaluate(shadow+".querySelector('textarea').value"),/Users|C:/);
  await shot('overview');
  await clickText('查看异常插件');
  await waitFor(async()=> (await text()).includes('显示 1 / 3'),'failed filter');
  assert.match(await text(),/dsh-plugin-market/);
  await clickText('全部');
  await evaluate("(()=>{var input="+shadow+".querySelector('input[type=search]');input.focus();input.value='theme';input.dispatchEvent(new Event('input'));})()");
  assert.match(await text(),/显示 1 \/ 3/);
  assert.equal(await evaluate(shadow+".activeElement && "+shadow+".activeElement.type"),'search');
  await navigate('history');
  assert.match(await text(), /版本变更/); assert.match(await text(), /移除/);
  await shot('history');
  await navigate('plugins');
  const rowClick = (name,label) => evaluate("Array.from("+shadow+".querySelectorAll('.bingo-plugin-list article')).find(r=>r.querySelector('strong').textContent==="+JSON.stringify(name)+").querySelectorAll('button')"+" && (()=>{var r=Array.from("+shadow+".querySelectorAll('.bingo-plugin-list article')).find(r=>r.querySelector('strong').textContent==="+JSON.stringify(name)+");Array.from(r.querySelectorAll('button')).find(b=>b.textContent==="+JSON.stringify(label)+").click()})()");
  await rowClick('dsh-whale-widget','标记试用');
  await waitFor(async () => (await text()).includes('试用中'), 'mark trial');
  await rowClick('dsh-whale-widget','保留');
  await waitFor(async () => (await text()).includes('暂无试用'), 'keep trial');
  await rowClick('dsh-whale-widget','标记试用');
  await waitFor(async () => (await text()).includes('试用中'), 'second trial');
  await rowClick('dsh-whale-widget','移除');
  assert.match(await text(), /确认移除/);
  assert.equal(await evaluate(shadow+".querySelectorAll('.bingo-plugin-list article').length"),3);
  await rowClick('dsh-whale-widget','确认移除');
  await waitFor(async () => (await text()).includes('暂无试用'), 'confirmed removal');
  assert.equal(await evaluate(shadow+".querySelectorAll('.bingo-plugin-list article').length"),2);
  await navigate('trials');
  assert.match(await text(), /待决定/);
  await shot('trials');
  await clickText('下次启动再问');
  await waitFor(async () => !(await text()).includes('待决定'), 'snooze');
  await navigate('checks&theme=dark');
  assert.match(await text(), /运行中/); assert.match(await text(), /加载失败/); assert.match(await text(), /无法确认/);
  await shot('checks-dark');
  await navigate('recovery');
  assert.match(await text(), /最小启动并重启/);
  assert.match(await text(), /离线入口/);
  assert.equal(await evaluate(shadow+".querySelector('[data-el=toolsTab]').getAttribute('aria-pressed')"),'true');
  await shot('minimal-boot');
  await navigate('recovery-legacy');
  assert.match(await text(), /最小启动并重启/);
  assert.match(await text(), /旧版社区插件停用记录/);
  await clickText('最小启动并重启');
  await clickText('恢复之前的选择');
  assert.equal(await evaluate("window.__BINGO_DEMO_CALLS__.filter(c=>c.url.includes('/rescue')).length"),0,'minimal boot confirmation does not authorize legacy restore');
  await clickText('确认恢复');
  await waitFor(async () => !(await text()).includes('旧版社区插件停用记录'), 'legacy recovery');
  assert.equal(await evaluate("window.__BINGO_DEMO_CALLS__.filter(c=>c.url.includes('/rescue'))[0].body.action"),'restore-legacy');
  await navigate('cleanup');
  await evaluate(shadow + ".querySelector('[data-el=deskContent] input[type=checkbox]').click()");
  await clickText('隔离所选');
  assert.match(await text(), /确认移入隔离区/);
  await clickText('确认移入隔离区');
  await waitFor(async () => (await text()).includes('已隔离'), 'quarantine');
  await shot('quarantine');
  await clickText('永久删除');
  assert.match(await text(), /确认永久删除/);
  assert.equal(await evaluate("window.__BINGO_DEMO_CALLS__.filter(c=>c.url.includes('/cleanup')&&c.body.action==='purge').length"),0);
  await clickText('恢复到原位置');
  await waitFor(async () => !(await text()).includes('已隔离'), 'restore quarantine');
  await navigate('health');
  assert.match(await text(), /5.8 s/); assert.match(await text(), /dsh-pet/); assert.match(await text(), /不代表因果关系/);
  assert.equal(await evaluate(shadow+".querySelector('[data-el=toolsTab]').getAttribute('aria-pressed')"),'true');
  await shot('startup-health');
  await navigate('health', 375, 700);

  const bounds = await evaluate("(()=>{const r=" + shadow + ".querySelector('[data-el=desk]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()");
  assert.ok(bounds.left >= 12 && bounds.right <= 363 && bounds.top >= 12 && bounds.bottom <= 688, JSON.stringify(bounds));
  await shot('health-mobile');
  await navigate('overview');
  await evaluate("window.__DSH_BINGO_TOOLS_URL__='missing-tools.js';"+shadow+".querySelector('[data-el=toolsTab]').click()");
  await waitFor(async()=> (await text()).includes('工具加载失败'),'lazy load failure');
  await evaluate(shadow+".querySelector('[data-el=overviewTab]').click()");
  await waitFor(async()=> (await text()).includes('保存后重启 Harness'),'core UI after tool failure');
  assert.deepEqual(errors, []);
  console.log('PASS real Edge: overview, search/filter, diagnostic privacy, lazy tools, trials, acceptance, minimal/offline entry, quarantine confirmation/restore, startup health and mobile layout');
  console.log('Screenshots: ' + dir);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await command('Browser.close'); } catch { /* page socket closes on shutdown */ }
    socket.close();
  }
  await sleep(300);
  try { browser.kill(); } catch { /* already exited */ }
}
