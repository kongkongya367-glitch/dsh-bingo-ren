// Offline design preview for the three README screenshots.
// Edge/Chromium cannot run inside this sandbox (named-pipe denial), so this script
// draws the same geometry and typography as preview/index.html with SVG + sharp.
// Usage: node preview/render-screenshots.mjs [outDir]
// Requires sharp; DSH bundles it, or install sharp in a scratch directory.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const outDir = resolve(process.env.BINGO_OUT || join(root, 'assets'));
mkdirSync(outDir, { recursive: true });

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch (err) {
  const fallback = process.env.BINGO_SHARP;
  if (!fallback) throw new Error('sharp not found; set BINGO_SHARP to an absolute sharp module path');
  sharp = require(fallback);
}

const W = 1440;
const H = 900;
const FONT = "'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif";
const MONO = "'Cascadia Mono','Consolas','SFMono-Regular',monospace";

const LIGHT = {
  bg: '#ffffff', side: '#f7f7f8', soft: '#f2f3f5', hover: '#ededef', chip: '#f4f5f6',
  line: '#e9eaec', lineSoft: '#f0f1f2', text: '#151619', text2: '#5f646b', text3: '#8c9197',
  ok: '#2f9e6b', ink: '#0f1115', ink2: '#5d636a', ink3: '#8b9198', onInk: '#ffffff',
  surface: '#ffffff', surface2: '#f5f6f7', border: 'rgba(15,17,21,0.09)',
  warn: '#9a6412', warnBg: '#fdf8ed', warnBorder: 'rgba(154,100,18,0.20)',
  scrim: 'rgba(16,18,22,0.32)', shadow: '#101216'
};
const DARK = {
  bg: '#15171a', side: '#181b1e', soft: '#22262a', hover: '#24282c', chip: '#202428',
  line: 'rgba(255,255,255,0.09)', lineSoft: 'rgba(255,255,255,0.06)', text: '#eef1f3',
  text2: '#a4aab1', text3: '#8a9199', ok: '#54c996', ink: '#f2f4f6', ink2: '#a8aeb5',
  ink3: '#8f959d', onInk: '#111315', surface: '#1c1f23', surface2: '#24282d',
  border: 'rgba(255,255,255,0.10)', warn: '#e9b96b', warnBg: 'rgba(233,185,107,0.075)',
  warnBorder: 'rgba(233,185,107,0.22)', scrim: 'rgba(5,6,8,0.5)', shadow: '#000000'
};
const C = Object.assign({}, LIGHT);
function setTheme(mode) { Object.assign(C, mode === 'dark' ? DARK : LIGHT); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function txt(x, y, value, o = {}) {
  const size = o.size == null ? 13 : o.size;
  const weight = o.weight == null ? 400 : o.weight;
  const fill = o.fill || C.text;
  const anchor = o.anchor || 'start';
  const family = o.mono ? MONO : FONT;
  const ls = o.ls == null ? '' : ' letter-spacing="' + o.ls + '"';
  return '<text x="' + x + '" y="' + y + '" font-family="' + family + '" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '" text-anchor="' + anchor + '"' + ls + '>' + esc(value) + '</text>';
}

function rect(x, y, w, h, o = {}) {
  const r = o.r == null ? 0 : o.r;
  const fill = o.fill || 'none';
  const stroke = o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw == null ? 1 : o.sw) + '"' : '';
  const filter = o.filter ? ' filter="url(#' + o.filter + ')"' : '';
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + r + '" fill="' + fill + '"' + stroke + filter + '/>';
}

const circle = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + fill + '"/>';
const strokePath = (d, color, sw = 1.5) => '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"/>';

const SPARK_D = 'M12 2.4c.47 4.74 3.86 8.13 8.6 8.6-4.74.47-8.13 3.86-8.6 8.6-.47-4.74-3.86-8.13-8.6-8.6 4.74-.47 8.13-3.86 8.6-8.6Z';
function spark(cx, cy, size, color) {
  const scale = size / 24;
  return '<g transform="translate(' + (cx - size / 2) + ' ' + (cy - size / 2) + ') scale(' + scale + ')"><path d="' + SPARK_D + '" fill="' + color + '"/></g>';
}
const check = (x, y, color) => strokePath('M' + x + ' ' + y + 'l3.2 3.2 6.4-6.8', color, 1.6);
const plus = (x, y, color) => strokePath('M' + (x + 5) + ' ' + y + 'v10M' + x + ' ' + (y + 5) + 'h10', color, 1.5);
const chevron = (x, y, color) => strokePath('M' + (x + 4) + ' ' + (y + 1.5) + 'L' + (x + 7.5) + ' ' + (y + 4.5) + 'L' + (x + 4) + ' ' + (y + 7.5), color, 1.4);
const dots = (x, y, color) => circle(x, y, 1.1, color) + circle(x + 4.8, y, 1.1, color) + circle(x + 9.6, y, 1.1, color);
const arrowUp = (cx, cy, color) => strokePath('M' + cx + ' ' + (cy + 4.6) + 'V' + (cy - 4.4) + 'M' + (cx - 3.8) + ' ' + (cy - 0.8) + ' ' + cx + ' ' + (cy - 4.6) + ' ' + (cx + 3.8) + ' ' + (cy - 0.8), color, 1.7);
const clockIcon = (x, y, color) => '<circle cx="' + (x + 5.5) + '" cy="' + (y + 5.5) + '" r="4.6" fill="none" stroke="' + color + '" stroke-width="1.3"/>' + strokePath('M' + (x + 5.5) + ' ' + (y + 3) + 'v2.5l1.6 1.1', color, 1.3);

function chatIcon(x, y, color) {
  return strokePath('M' + (x + 13) + ' ' + (y + 7) + 'c0 2.9-2.5 5.2-5.6 5.2-.7 0-1.4-.1-2-.3L' + (x + 1) + ' ' + (y + 12) + 'l.7-2.7c-.4-.7-.6-1.5-.6-2.3 0-2.9 2.5-5.2 5.6-5.2s4.9 2.3 4.9 4.5Z', color, 1.35);
}
function puzzleIcon(x, y, color) {
  return strokePath('M' + (x + 5.2) + ' ' + (y + 6.2) + 'h5.6a3.1 3.1 0 0 1 3.1 3.1v.5a3.1 3.1 0 0 1-3.1 3.1H' + (x + 5.2) + 'a3.1 3.1 0 0 1-3.1-3.1v-.5a3.1 3.1 0 0 1 3.1-3.1ZM' + (x + 5.2) + ' ' + (y + 2.2) + 'v4M' + (x + 10.8) + ' ' + (y + 2.2) + 'v4M' + (x + 8) + ' ' + (y + 12.9) + 'v2.1', color, 1.35);
}
function gearIcon(x, y, color) {
  let out = '<circle cx="' + (x + 7) + '" cy="' + (y + 7) + '" r="4.1" fill="none" stroke="' + color + '" stroke-width="1.35"/>';
  out += '<circle cx="' + (x + 7) + '" cy="' + (y + 7) + '" r="1.5" fill="none" stroke="' + color + '" stroke-width="1.35"/>';
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    out += strokePath('M' + (x + 7 + Math.cos(a) * 4.1) + ' ' + (y + 7 + Math.sin(a) * 4.1) + 'L' + (x + 7 + Math.cos(a) * 6.1) + ' ' + (y + 7 + Math.sin(a) * 6.1), color, 1.35);
  }
  return out;
}

function defs() {
  return '<defs>' +
    '<filter id="shadowPill" x="-60%" y="-120%" width="220%" height="340%">' +
      '<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="' + C.shadow + '" flood-opacity="0.07"/>' +
      '<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="' + C.shadow + '" flood-opacity="0.18"/>' +
    '</filter>' +
    '<filter id="shadowPanel" x="-40%" y="-30%" width="180%" height="180%">' +
      '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="' + C.shadow + '" flood-opacity="0.06"/>' +
      '<feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="' + C.shadow + '" flood-opacity="0.20"/>' +
    '</filter>' +
    '<filter id="shadowDialog" x="-40%" y="-40%" width="180%" height="200%">' +
      '<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="' + C.shadow + '" flood-opacity="0.08"/>' +
      '<feDropShadow dx="0" dy="40" stdDeviation="46" flood-color="' + C.shadow + '" flood-opacity="0.26"/>' +
    '</filter>' +
    '<filter id="shadowComposer" x="-20%" y="-40%" width="140%" height="220%">' +
      '<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="' + C.shadow + '" flood-opacity="0.04"/>' +
      '<feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="' + C.shadow + '" flood-opacity="0.10"/>' +
    '</filter>' +
    '<filter id="shadowActive" x="-20%" y="-40%" width="140%" height="220%">' +
      '<feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="' + C.shadow + '" flood-opacity="0.04"/>' +
      '<feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="' + C.shadow + '" flood-opacity="0.05"/>' +
    '</filter>' +
  '</defs>';
}

function sidebar() {
  const out = [];
  out.push(rect(0, 0, 252, H, { fill: C.side }));
  out.push('<line x1="251.5" y1="0" x2="251.5" y2="' + H + '" stroke="' + C.line + '"/>');
  out.push(rect(17, 18, 22, 22, { r: 7, fill: C.ink }) + spark(28, 29, 12, C.onInk));
  out.push(txt(48, 33.5, 'DeepSeek Harness', { size: 12.8, weight: 650, ls: '-0.1' }));
  out.push(rect(196, 20, 39, 18, { r: 5, stroke: C.line, fill: C.bg }));
  out.push(txt(215.5, 32.5, '0.2.1', { size: 9.5, weight: 500, fill: C.text3, anchor: 'middle' }));
  out.push(rect(12, 58, 228, 34, { r: 9, fill: C.bg, stroke: C.line, filter: 'shadowActive' }));
  out.push(plus(22, 69, C.text2) + txt(43, 79, '新建对话', { size: 12.5, weight: 550 }));
  out.push(txt(230, 79, 'Ctrl N', { size: 9.5, weight: 500, fill: C.text3, anchor: 'end', mono: true }));
  out.push(rect(12, 102, 228, 32, { r: 8, fill: C.bg, filter: 'shadowActive' }));
  out.push(chatIcon(21, 110, C.text) + txt(45, 122, '对话', { size: 12.5, weight: 550 }));
  out.push(puzzleIcon(21, 143, C.text2) + txt(45, 155, '插件', { size: 12.5, fill: C.text2 }));
  out.push(gearIcon(21, 176, C.text2) + txt(45, 188, '设置', { size: 12.5, fill: C.text2 }));
  out.push(txt(21, 227, '今天', { size: 10, weight: 650, fill: C.text3, ls: '0.7' }));
  out.push(rect(12, 238, 228, 30, { r: 7, fill: C.hover }));
  out.push(txt(21, 257, 'Bingo 插件设计评审', { size: 12.2, fill: C.text }));
  out.push(txt(231, 256, '12:04', { size: 9.5, fill: C.text3, anchor: 'end' }));
  out.push(txt(21, 287, '重启 helper 与端口释放', { size: 12.2, fill: C.text2 }));
  out.push(txt(21, 317, '插件市场条目草案', { size: 12.2, fill: C.text2 }));
  out.push(txt(21, 351, '昨天', { size: 10, weight: 650, fill: C.text3, ls: '0.7' }));
  out.push(txt(21, 374, 'DSH 主题变量调研', { size: 12.2, fill: C.text2 }));
  out.push(txt(21, 404, '新插件提示策略', { size: 12.2, fill: C.text2 }));
  out.push('<line x1="20" y1="850" x2="232" y2="850" stroke="' + C.lineSoft + '"/>');
  out.push(circle(32, 874, 12, '#eceef0') + txt(32, 878, 'L', { size: 10.5, weight: 650, fill: C.text2, anchor: 'middle' }));
  out.push(txt(53, 870, 'Lead', { size: 11.8, weight: 600 }) + txt(53, 883, 'desktop · 本地', { size: 10, fill: C.text3 }));
  out.push(dots(207, 874, C.text3));
  return out.join('');
}

function topbar() {
  const out = [];
  out.push('<line x1="252" y1="53.5" x2="1440" y2="53.5" stroke="' + C.line + '"/>');
  out.push(txt(274, 32.5, '对话', { size: 12.5, fill: C.text3 }));
  out.push(chevron(294, 25, C.text3));
  out.push(txt(312, 32.5, 'Bingo 插件设计评审', { size: 12.8, weight: 600 }));
  out.push(rect(1282, 14, 118, 26, { r: 13, stroke: C.line, fill: C.bg }));
  out.push(circle(1295, 27, 2.5, C.ok));
  out.push(txt(1304, 31, 'deepseek-v3.2', { size: 11, weight: 500, fill: C.text2 }));
  out.push(dots(1409, 27, C.text3));
  return out.join('');
}

function conversation() {
  const out = [];
  const chatX = 486;
  const chatW = 720;
  const b1w = 536;
  const b1x = chatX + chatW - b1w;
  out.push(rect(b1x, 84, b1w, 64, { r: 14, fill: C.soft }));
  out.push(txt(b1x + 14, 111, '帮我给 Bingo 插件做一版更像原生 DSH 的界面：', { size: 13 }));
  out.push(txt(b1x + 14, 132.5, '按钮固定在左下角，浅色深色都要好看，别太花。', { size: 13 }));
  out.push(rect(chatX, 171, 26, 26, { r: 8, fill: C.ink }) + spark(chatX + 13, 184, 14, C.onInk));
  out.push(txt(chatX + 38, 181, 'DeepSeek Harness', { size: 10.5, weight: 600, fill: C.text2 }));
  out.push(circle(chatX + 143, 178, 1, C.text3));
  out.push(txt(chatX + 150, 181, '刚刚', { size: 10.5, fill: C.text3 }));
  const tx = chatX + 38;
  out.push(txt(tx, 210, '好。整体保持克制：中性纸白、1px 细边、低饱和阴影，圆角', { size: 13.2 }));
  out.push(txt(tx, 232.7, '14–18px，蓝色只出现在焦点态。控件全部落在 Shadow DOM 里，', { size: 13.2 }));
  out.push(txt(tx, 255.4, '不依赖 React。', { size: 13.2 }));
  const planY = 275;
  out.push(rect(tx, planY, 682, 108, { r: 12, fill: C.side, stroke: C.line }));
  out.push(txt(tx + 14, planY + 25, '实现方案', { size: 9.8, weight: 650, fill: C.text3, ls: '1.2' }));
  const rows = [
    '左下角 44px 胶囊，面板锚定在按钮上方',
    '新插件居中弹层，遮罩 blur(6px)',
    '重启等待态，12s 后提示手动恢复'
  ];
  rows.forEach((label, i) => {
    const y = planY + 43 + i * 22;
    out.push(check(tx + 15, y + 1, C.ok) + txt(tx + 32, y + 4.2, label, { size: 12, fill: C.text2 }));
  });
  out.push(txt(tx, 410, '样式变量已经就绪，深色适配和键盘操作也写进了', { size: 13.2 }));
  out.push(txt(tx, 432.7, 'client/bingo-client.js。预览页里可以直接看三种状态。', { size: 13.2 }));
  const b2w = 120;
  const b2x = chatX + chatW - b2w;
  out.push(rect(b2x, 463, b2w, 42, { r: 14, fill: C.soft }));
  out.push(txt(b2x + 14, 489.5, '截图给我看看。', { size: 13 }));
  return out.join('');
}

function composer() {
  const out = [];
  const x = 486;
  const w = 720;
  out.push(rect(x, 776, w, 84, { r: 16, fill: C.bg, stroke: C.line, filter: 'shadowComposer' }));
  out.push(txt(x + 14, 800, '给 DeepSeek Harness 发送消息…', { size: 13.2, fill: C.text3 }));
  out.push(rect(x + 14, 822, 82, 24, { r: 7, fill: C.chip }));
  out.push(plus(x + 18, 827, C.text2) + txt(x + 35, 838.5, '计划模式', { size: 11, weight: 500, fill: C.text2 }));
  out.push(rect(x + 102, 822, 54, 24, { r: 7, fill: C.chip }));
  out.push(txt(x + 114, 838.5, '文件', { size: 11, weight: 500, fill: C.text2 }));
  out.push(txt(x + w - 78, 838.5, 'Enter 发送', { size: 10, fill: C.text3, anchor: 'end' }));
  out.push(rect(x + w - 42, 820, 28, 28, { r: 9, fill: C.ink }));
  out.push(arrowUp(x + w - 28, 834, C.onInk));
  out.push(txt(x + w / 2, 886, '响应由模型生成，请核查重要信息', { size: 10, fill: C.text3, anchor: 'middle' }));
  return out.join('');
}

function mockPage() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    defs() + rect(0, 0, W, H, { fill: C.bg }) + sidebar() + topbar() + conversation() + composer() + '</svg>';
}

function pill() {
  const x = 18;
  const y = H - 108;
  const w = 98;
  return rect(x, y, w, 44, { r: 22, fill: C.surface, stroke: C.border, filter: 'shadowPill' }) +
    rect(x + 11, y + 9, 24, 24, { r: 8, fill: C.ink }) +
    spark(x + 23, y + 21, 13, C.onInk) +
    txt(x + 44, y + 26.3, 'Bingo', { size: 13, weight: 600, ls: '0.15' });
}

function panelSvg(hasPending = false) {
  const panelH = hasPending ? 374 : 262;
  const x = 18;
  const top = H - 118 - panelH;
  const w = 312;
  const innerX = x + 14;
  const out = [];
  out.push(rect(x, top, w, panelH, { r: 16, fill: C.surface, stroke: C.border, filter: 'shadowPanel' }));
  const hy = top + 14;
  out.push(rect(innerX, hy, 22, 22, { r: 7, fill: C.ink }) + spark(innerX + 11, hy + 11, 12, C.onInk));
  out.push(txt(innerX + 29, hy + 15.2, 'Bingo', { size: 13.5, weight: 650 }));
  out.push(rect(innerX + 68, hy + 3, 39, 17, { r: 5, fill: C.surface2, stroke: C.border }));
  out.push(txt(innerX + 87.5, hy + 14.6, 'v0.1.1', { size: 10, weight: 500, fill: C.ink3, anchor: 'middle' }));
  out.push(strokePath('M' + (x + w - 33) + ' ' + (hy + 8) + 'l8 8M' + (x + w - 25) + ' ' + (hy + 8) + 'l-8 8', C.ink3, 1.6));
  const sy = top + 48;
  out.push(circle(innerX + 3, sy + 9, 3, C.ok));
  out.push(txt(innerX + 16, sy + 13.3, 'Harness 桌面端 · 可重启', { size: 12, fill: C.ink2 }));
  let cursor = sy + 18;
  if (hasPending) {
    const py = cursor + 12;
    const ph = 100;
    out.push(rect(innerX, py, 284, ph, { r: 12, fill: C.warnBg, stroke: C.warnBorder }));
    out.push(txt(innerX + 10, py + 22, '检测到新插件', { size: 11.5, weight: 650, fill: C.warn }));
    out.push(txt(innerX + 274, py + 22, '3 个', { size: 10, weight: 500, fill: C.warn, anchor: 'end' }));
    const pkgs = [['dsh-whale-widget', 'v0.4.2'], ['dsh-plugin-market', 'v1.8.0'], ['dsh-theme-paper', 'v0.2.1']];
    pkgs.forEach((p, i) => {
      const ry = py + 40 + i * 17;
      out.push(txt(innerX + 10, ry, p[0], { size: 10.8, mono: true, fill: C.ink }) + txt(innerX + 274, ry, p[1], { size: 10.5, fill: C.ink3, anchor: 'end' }));
    });
    cursor = py + ph;
  }
  const ay = cursor + 13;
  out.push(rect(innerX, ay, 284, 36, { r: 10, fill: C.ink }));
  out.push(txt(innerX + 142, ay + 22, 'Bingo 一下', { size: 12.5, weight: 600, fill: C.onInk, anchor: 'middle' }));
  out.push(rect(innerX, ay + 42, 284, 36, { r: 10, fill: 'none', stroke: C.border }));
  out.push(txt(innerX + 142, ay + 64, '稍后', { size: 12.5, weight: 550, fill: C.ink, anchor: 'middle' }));
  const noteY = ay + 78 + 9 + 12;
  out.push(txt(x + w / 2, noteY, '会中断正在进行的任务，约 3 秒恢复', { size: 10.8, fill: C.ink3, anchor: 'middle' }));
  const metaY = noteY + 25;
  out.push(clockIcon(innerX, metaY - 9, C.ink3) + txt(innerX + 17, metaY, '上次重启 · 10月19日 12:04 · 成功', { size: 10.8, fill: C.ink3 }));
  const footTop = metaY + 16;
  out.push('<line x1="' + innerX + '" y1="' + footTop + '" x2="' + (x + w - 14) + '" y2="' + footTop + '" stroke="' + C.border + '"/>');
  out.push(txt(innerX, footTop + 19, '快捷键', { size: 10.5, fill: C.ink3 }));
  out.push(rect(x + w - 86, footTop + 8, 72, 18, { r: 5, fill: C.surface2, stroke: C.border }));
  out.push(txt(x + w - 50, footTop + 20, 'Ctrl + Alt + B', { size: 9.8, mono: true, fill: C.ink2, anchor: 'middle' }));
  return out.join('');
}

function dialogSvg() {
  const w = 360;
  const h = 345;
  const x = (W - w) / 2;
  const top = (H - h) / 2;
  const innerX = x + 20;
  const out = [];
  out.push(rect(0, 0, W, H, { fill: C.scrim }));
  out.push(rect(x, top, w, h, { r: 18, fill: C.surface, stroke: C.border, filter: 'shadowDialog' }));
  out.push(rect(innerX, top + 20, 38, 38, { r: 12, fill: C.warnBg, stroke: C.warnBorder }));
  out.push(spark(innerX + 19, top + 39, 20, C.warn));
  out.push(txt(innerX, top + 83, '检测到新插件', { size: 15, weight: 650, ls: '-0.2' }));
  out.push(txt(innerX, top + 105, '是否要 Bingo 一下？重启 Harness 后新插件', { size: 12.5, fill: C.ink2 }));
  out.push(txt(innerX, top + 124.4, '才会生效。', { size: 12.5, fill: C.ink2 }));
  const listY = top + 143;
  out.push(rect(innerX, listY, 320, 98, { r: 11, fill: C.surface2, stroke: C.border }));
  const pkgs = [['dsh-whale-widget', 'v0.4.2'], ['dsh-plugin-market', 'v1.8.0'], ['dsh-theme-paper', 'v0.2.1']];
  pkgs.forEach((p, i) => {
    if (i > 0) out.push('<line x1="' + (innerX + 1) + '" y1="' + (listY + i * 30 + 1) + '" x2="' + (innerX + 319) + '" y2="' + (listY + i * 30 + 1) + '" stroke="' + C.border + '"/>');
    const ry = listY + 23 + i * 30;
    out.push(txt(innerX + 10, ry, p[0], { size: 11.5, mono: true, fill: C.ink }) + txt(innerX + 310, ry, p[1], { size: 10.5, fill: C.ink3, anchor: 'end' }));
  });
  const ay = listY + 98 + 16;
  out.push(rect(innerX, ay, 156, 36, { r: 10, fill: C.ink }));
  out.push(txt(innerX + 78, ay + 22, '立即 Bingo', { size: 12.5, weight: 600, fill: C.onInk, anchor: 'middle' }));
  out.push(rect(innerX + 164, ay, 156, 36, { r: 10, fill: 'none', stroke: C.border }));
  out.push(txt(innerX + 242, ay + 22, '稍后', { size: 12.5, weight: 550, fill: C.ink, anchor: 'middle' }));
  out.push(txt(x + w / 2, ay + 36 + 21, '稍后可从左下角的 Bingo 面板随时处理', { size: 10.8, fill: C.ink3, anchor: 'middle' }));
  return out.join('');
}

function widget(body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + defs() + body + '</svg>';
}

async function toPng(svg) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  const page = await toPng(mockPage());

  await sharp(page).composite([{ input: await toPng(widget(pill())) }]).png({ compressionLevel: 9 }).toFile(join(outDir, 'screenshot-button.png'));

  await sharp(page).composite([{ input: await toPng(widget(pill() + panelSvg(false))) }]).png({ compressionLevel: 9 }).toFile(join(outDir, 'screenshot-panel.png'));

  const base = await sharp(page).composite([{ input: await toPng(widget(pill())) }]).blur(4.2).toBuffer();
  const dialog = await toPng(widget(dialogSvg()));
  await sharp(base).composite([{ input: dialog }]).png({ compressionLevel: 9 }).toFile(join(outDir, 'screenshot-new-plugin.png'));

  setTheme('dark');
  const darkPage = await toPng(mockPage());
  await sharp(darkPage).composite([{ input: await toPng(widget(pill() + panelSvg(false))) }]).png({ compressionLevel: 9 }).toFile(join(outDir, 'screenshot-panel-dark.png'));
  setTheme('light');

  console.log('wrote screenshot-button.png, screenshot-panel.png, screenshot-new-plugin.png, screenshot-panel-dark.png to', outDir);
}

export { main };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}