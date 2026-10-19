#!/usr/bin/env node
/* Minimal asar toolkit: ls | cat | extract | grep. Requires Electron node mode (ELECTRON_RUN_AS_NODE=1) for asar fs support. */
const fs = require('fs');
const path = require('path');
const [cmd, ...args] = process.argv.slice(2);
const ASAR = 'D:/DeepSeekharness/resources/app.asar';
function p(x) { return path.posix.join(ASAR, x || ''); }
if (cmd === 'ls') {
  const dir = p(args[0]);
  for (const name of fs.readdirSync(dir)) {
    let st; try { st = fs.statSync(path.posix.join(dir, name)); } catch (e) { st = { size: 0, isDirectory: () => false }; }
    console.log((st.isDirectory() ? 'd ' : 'f ') + String(st.size).padStart(9) + '  ' + name);
  }
} else if (cmd === 'cat') {
  process.stdout.write(fs.readFileSync(p(args[0]), 'utf8'));
} else if (cmd === 'extract') {
  const src = p(args[0]); const dest = path.resolve(args[1]);
  let count = 0, bytes = 0;
  function walk(from, to) {
    const names = fs.readdirSync(from);
    fs.mkdirSync(to, { recursive: true });
    for (const name of names) {
      const s = path.posix.join(from, name), d = path.join(to, name);
      const st = fs.statSync(s);
      if (st.isDirectory()) walk(s, d);
      else { fs.writeFileSync(d, fs.readFileSync(s)); count++; bytes += st.size; }
    }
  }
  walk(src, dest);
  console.log('extracted ' + count + ' files, ' + (bytes/1024/1024).toFixed(1) + ' MB -> ' + dest);
} else if (cmd === 'grep') {
  const pattern = new RegExp(args[0], 'i');
  const root = p(args[1] || '');
  const limit = Number(args[2] || 200);
  let hits = 0;
  (function walk(dir) {
    if (hits >= limit) return;
    let names; try { names = fs.readdirSync(dir); } catch (e) { return; }
    for (const name of names) {
      if (hits >= limit) return;
      const full = path.posix.join(dir, name);
      let st; try { st = fs.statSync(full); } catch (e) { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      if (!/\.(m?js|cjs|ts|json|yml|yaml|md)$/.test(name)) continue;
      let text; try { text = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          hits++;
          console.log(full.replace(ASAR + '/', '') + ':' + (i + 1) + ': ' + lines[i].trim().slice(0, 240));
          if (hits >= limit) return;
        }
      }
    }
  })(root);
  if (hits === 0) console.log('no matches');
} else {
  console.error('usage: asar.cjs ls|cat|extract|grep <arg>');
  process.exit(1);
}
