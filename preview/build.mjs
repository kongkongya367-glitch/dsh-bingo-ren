// Build client/bingo-client.{js,css} from the readable sources in preview/src/.
// Zero dependencies: a small token-preserving JS minifier + a CSS whitespace pass.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const SRC = join(here, 'src');
const OUT = join(root, 'client');

const JS_BANNER = '/*! dsh-bingo-restart | preview/src */\n';
const CSS_BANNER = '/*! dsh-bingo-restart | preview/src */\n';

const PUNCT = [
  '>>>=', '===', '!==', '>>>', '**=', '&&=', '||=', '??=', '...', '=>', '==', '!=', '<=', '>=',
  '++', '--', '+=', '-=', '*=', '/=', '%=', '&&', '||', '??', '?.', '<<', '>>', '&=', '|=', '^=',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '%', '&', '|', '^', '!', '~',
  '?', ':', '=', '.', '/'
];
const WORD = /[A-Za-z0-9_$]/;
const ID_START = /[A-Za-z_$]/;

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'word') {
    return ['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await'].indexOf(prev.value) !== -1;
  }
  if (prev.type === 'punct') return [')', ']', '}'].indexOf(prev.value) === -1;
  return false;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  let prev = null;
  const push = (type, value) => {
    const token = { type, value };
    tokens.push(token);
    prev = token;
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '/' && regexAllowed(prev)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j += 1;
      }
      j += 1;
      while (j < src.length && /[a-z]/i.test(src[j])) j += 1;
      push('regex', src.slice(i, j));
      i = j;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === c) { j += 1; break; }
        j += 1;
      }
      push('string', src.slice(i, j));
      i = j;
      continue;
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < src.length && WORD.test(src[j])) j += 1;
      push('word', src.slice(i, j));
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      if (c === '0' && /[xXbBoO]/.test(src[j + 1] || '')) {
        j += 2;
        while (j < src.length && /[0-9a-fA-F_]/.test(src[j])) j += 1;
      } else {
        while (j < src.length && /[0-9_]/.test(src[j])) j += 1;
        if (src[j] === '.') { j += 1; while (j < src.length && /[0-9_]/.test(src[j])) j += 1; }
        if (src[j] === 'e' || src[j] === 'E') {
          j += 1;
          if (src[j] === '+' || src[j] === '-') j += 1;
          while (j < src.length && /[0-9_]/.test(src[j])) j += 1;
        }
      }
      push('number', src.slice(i, j));
      i = j;
      continue;
    }
    let punct = null;
    for (const p of PUNCT) {
      if (src.startsWith(p, i)) { punct = p; break; }
    }
    if (!punct) throw new Error('Unexpected character at ' + i + ': ' + JSON.stringify(c));
    push('punct', punct);
    i += punct.length;
  }
  return tokens;
}

function needsSpace(a, b) {
  if (!a) return false;
  if (WORD.test(a.value[a.value.length - 1]) && WORD.test(b.value[0])) return true;
  if ((a.value === '+' && b.value[0] === '+') || (a.value === '-' && b.value[0] === '-')) return true;
  if (a.value === '/' && b.value[0] === '/') return true;
  return false;
}


const CLASS_MAP = {"bingo-root":"r","bingo-pill":"p","bingo-pill__label":"pl","bingo-pill__dot":"pd","bingo-pill__spin":"ps","bingo-mark":"mk","bingo-mark--sm":"mks","bingo-panel":"pn","bingo-head":"hd","bingo-head__title":"ht","bingo-title":"ti","bingo-version":"vr","bingo-iconbtn":"ib","bingo-status":"st","bingo-dot":"dt","bingo-pending":"pg","bingo-pending__head":"pgh","bingo-pending__title":"pgt","bingo-count":"cnt","bingo-pkgs":"pks","bingo-pkgs--dialog":"pksd","bingo-pkg":"pk","bingo-pkg__name":"pkn","bingo-pkg__ver":"pkv","bingo-more":"mo","bingo-more--dialog":"mod","bingo-actions":"ac","bingo-btn":"bt","bingo-btn--primary":"btp","bingo-btn--ghost":"btg","bingo-btn__spin":"bts","bingo-note":"nt","bingo-error":"er","bingo-meta":"mt","bingo-foot":"ft","bingo-kbd":"kb","bingo-layer":"ly","bingo-layer--dialog":"lyd","bingo-layer--restart":"lyr","bingo-dialog":"dlg","bingo-dialog-title":"dlt","bingo-dialog-desc":"dld","bingo-dialog__icon":"dli","bingo-dialog__title":"dlt2","bingo-dialog__desc":"dld2","bingo-dialog__actions":"dla","bingo-dialog__hint":"dlh","bingo-restart":"rs","bingo-restart__title":"rst","bingo-restart__hint":"rsh","bingo-restart__manual":"rsm","bingo-spinner":"sp","bingo-sr":"sr"};
function shortenClasses(src) {
  let out = src;
  const keys = Object.keys(CLASS_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    out = out.split(key).join(CLASS_MAP[key]);
  }
  return out;
}


const VAR_MAP = {"--bingo-font":"--f","--bingo-mono":"--m","--bingo-ink":"--i","--bingo-ink-2":"--i2","--bingo-ink-3":"--i3","--bingo-ink-hover":"--ih","--bingo-on-ink":"--oi","--bingo-surface":"--s","--bingo-surface-2":"--s2","--bingo-border":"--bd","--bingo-border-strong":"--bs","--bingo-hover":"--hv","--bingo-accent":"--a","--bingo-success":"--ok","--bingo-warn":"--w","--bingo-warn-bg":"--wb","--bingo-warn-border":"--wbd","--bingo-danger":"--dg","--bingo-danger-bg":"--dgb","--bingo-scrim":"--sc","--bingo-restart-scrim":"--rc","--bingo-shadow-pill":"--shp","--bingo-shadow-pill-hover":"--shph","--bingo-shadow-panel":"--shn","--bingo-shadow-dialog":"--shd"};
function shortenVars(src) {
  let out = src;
  for (const key of Object.keys(VAR_MAP).sort((a, b) => b.length - a.length)) {
    out = out.split(key).join(VAR_MAP[key]);
  }
  return out;
}


const STATE_MAP = {"status":"st","pending":"pd","version":"v","failures":"f","ready":"rd","shown":"sh","panel":"pn","dialog":"dl","dialogSig":"dg","restarting":"rs","busy":"bs","emitted":"em","inFlight":"fl","timer":"tm","manualTimer":"mt","pollMs":"pm","seen":"sn"};
function shortenState(src) {
  let out = src;
  for (const key of Object.keys(STATE_MAP).sort((a, b) => b.length - a.length)) {
    out = out.split('S.' + key).join('S.' + STATE_MAP[key]);
  }
  const start = out.indexOf('var S = {');
  const end = out.indexOf('};', start);
  if (start !== -1 && end !== -1) {
    const block = out.slice(start, end);
    let next = block;
    for (const key of Object.keys(STATE_MAP)) {
      next = next.replace(new RegExp('(\\n\\s+)' + key + ':'), '$1' + STATE_MAP[key] + ':');
    }
    out = out.slice(0, start) + next + out.slice(end);
  }
  return out;
}

function minifyJs(src) {
  const before = tokenize(src);
  let out = '';
  let prev = null;
  for (const token of before) {
    if (needsSpace(prev, token)) out += ' ';
    out += token.value;
    prev = token;
  }
  const after = tokenize(out);
  if (before.length !== after.length) throw new Error('Token count mismatch: ' + before.length + ' vs ' + after.length);
  for (let i = 0; i < before.length; i += 1) {
    if (before[i].type !== after[i].type || before[i].value !== after[i].value) {
      throw new Error('Token mismatch at ' + i + ': ' + JSON.stringify(before[i]) + ' vs ' + JSON.stringify(after[i]));
    }
  }
  // Strip a trailing semicolon-free IIFE is fine; validate parse without executing.
  new Function(out);
  return out;
}

function minifyCss(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/\s+/g, ' ');
  out = out.replace(/\s*([{}:;,>])\s*/g, '$1');
  out = out.replace(/;}/g, '}');
  return out.trim();
}

mkdirSync(OUT, { recursive: true });

const jsSrc = readFileSync(join(SRC, 'bingo-client.js'), 'utf8');
const jsOut = JS_BANNER + minifyJs(shortenState(shortenClasses(jsSrc)));
writeFileSync(join(OUT, 'bingo-client.js'), jsOut);

const cssSrc = readFileSync(join(SRC, 'bingo-client.css'), 'utf8');
const cssOut = CSS_BANNER + minifyCss(shortenVars(shortenClasses(cssSrc)));
writeFileSync(join(OUT, 'bingo-client.css'), cssOut);

console.log('client/bingo-client.js  ' + jsOut.length + ' bytes');
console.log('client/bingo-client.css ' + cssOut.length + ' bytes');
console.log('total ' + (jsOut.length + cssOut.length) + ' bytes');
