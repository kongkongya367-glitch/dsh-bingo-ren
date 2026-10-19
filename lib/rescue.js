/** Deferred minimal boot and exact, conflict-checked profile restoration. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomic, canonical, confined, fault, profileKey, readJSON, writeJSON, withProfileLock, alive } from './local-state.js';

const FILES = ['package.json', 'cordis.patch.yml', 'cordis.patch.yaml'];
const CORE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
const SELF = 'dsh-bingo-ren';

export function createRescue({ profileDir, stateDir, now = () => Date.now() }) {
  profileDir = canonical(profileDir);
  stateDir = path.resolve(stateDir);
  const folder = path.join(stateDir, 'rescue-' + profileKey(profileDir));
  const stateFile = path.join(folder, 'state.json');
  const clock = () => new Date(now()).toISOString();
  const state = () => {
    const value = readJSON(stateFile);
    const identity = p => process.platform==='win32' ? p.toLowerCase() : p;
    return typeof value?.profile==='string' && identity(value.profile)===identity(profileDir) && value.schema === 1 ? value : null;
  };
  function capture() {
    const result = {};
    for (const name of FILES) {
      const file = confined(profileDir, name, { missing: true });
      if (!fs.existsSync(file)) result[name] = null;
      else {
        if (fs.statSync(file).size > 2 * 1024 * 1024) throw fault('profile-file-too-large');
        result[name] = fs.readFileSync(file).toString('base64');
      }
    }
    return result;
  }
  const matches = (actual, expected) => FILES.every(name => actual[name] === expected[name]);
  const knownState = (actual,s) => FILES.every(name => actual[name] === s.before[name] || actual[name] === s.after[name]);
  function replace(files) {
    for (const name of FILES) {
      const file = confined(profileDir, name, { missing: true });
      if (files[name] === null) fs.rmSync(file, { force: true });
      else atomic(file, Buffer.from(files[name], 'base64'));
    }
  }
  function summary() {
    const s = state();
    if (!s || s.phase === 'restored') return { active: false, phase: s?.phase || null, backupDir: folder };
    return { active: true, id: s.id, phase: s.phase, at: s.at, disabled: s.disabled, kept: s.kept, backupDir: path.join(folder,'backups',s.id) };
  }
  function prepare(action, { withoutBingo = false } = {}) {
    if (!['enter', 'restore'].includes(action)) throw fault('invalid-action');
    return withProfileLock(profileDir, () => {
      let s = state();
      const current = capture();
      if (action === 'enter') {
        if (s && s.phase !== 'restored') throw fault('rescue-already-active');
        const manifest = JSON.parse(Buffer.from(current['package.json'] || '', 'base64').toString('utf8'));
        const selected = manifest?.dsh?.profile?.bundles;
        if (!Array.isArray(selected) || !CORE.every(name => selected.includes(name))) throw fault('unsupported-profile-layout');
        const kept = selected.filter(name => CORE.includes(name) || (!withoutBingo && name === SELF));
        if (!withoutBingo && manifest.dependencies?.[SELF] && !kept.includes(SELF)) kept.push(SELF);
        const safe = structuredClone(manifest);
        safe.dsh.profile.bundles = kept;
        const after = { 'package.json': Buffer.from(JSON.stringify(safe, null, 2) + '\n').toString('base64'),
          'cordis.patch.yml': Buffer.from('[]\n').toString('base64'),
          'cordis.patch.yaml': current['cordis.patch.yaml'] === null ? null : Buffer.from('[]\n').toString('base64') };
        s = { schema: 1, profile: profileDir, id: randomUUID(), at: clock(), phase: 'prepared', action, before: current, after,
          kept, disabled: selected.filter(name => !kept.includes(name)) };
        writeJSON(path.join(folder, 'backup-' + s.id + '.json'), s);
        for (const name of FILES) if(current[name]!==null) atomic(path.join(folder,'backups',s.id,name),Buffer.from(current[name],'base64'));
      } else {
        if (!s || s.phase === 'restored') throw fault('no-rescue-backup');
        if (!knownState(current,s)) throw fault('configuration-changed');
        s = { ...s, action, stage: randomUUID() };
      }
      writeJSON(stateFile, s);
      return { id: s.stage || s.id, action, profileDir, stateDir };
    });
  }
  function apply(task, { closed = false, hostPid, shellPid } = {}) {
    if (!closed || alive(hostPid) || alive(shellPid)) throw fault('application-still-running');
    return withProfileLock(profileDir, () => {
      const s = state();
      if (!s || s.phase==='restored' || task.id !== (s.stage || s.id) || task.action !== s.action) throw fault('stale-rescue-task');
      const before = capture();
      if (s.action==='enter' ? !matches(before,s.before) : !knownState(before,s)) throw fault('configuration-changed');
      const desired = s.action === 'enter' ? s.after : s.before;
      try {
        replace(desired);
        writeJSON(stateFile, { ...s, phase: s.action === 'enter' ? 'active' : 'restored', appliedAt: clock() });
      } catch (error) {
        try { replace(before); } catch { throw fault('profile-restore-required'); }
        throw error;
      }
      return summary();
    });
  }
  function installOfflineTool({ moduleDir, execPath, electron = false }) {
    const bin = path.join(folder, 'bin');
    for (const name of ['rescue-cli.mjs', 'rescue.js', 'local-state.js']) {
      atomic(path.join(bin, name), fs.readFileSync(path.join(moduleDir, name)));
    }
    // Independent of the installed package tree, so it survives a bad update.
    atomic(path.join(bin, 'package.json'), '{"type":"module"}\n');
    const tools = path.join(stateDir, '救援');
    const launcher = path.join(tools, 'Bingo-' + profileKey(profileDir).slice(0, 8) + '-急救.cmd');
    const quote = value => '"' + String(value).replace(/%/g, '%%') + '"';
    const cli = path.join(bin, 'rescue-cli.mjs');
    writeJSON(path.join(folder,'session.json'),{hostPid:process.pid,shellPid:process.ppid,at:clock()});
    if (process.platform === 'win32') atomic(launcher,
      '@echo off\r\nchcp 65001 >nul\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n' +
      quote(execPath) + (electron ? ' --expose-internals' : '') + ' ' + quote(cli) + ' menu --profile ' + quote(profileDir) + ' --state ' + quote(stateDir) + '\r\npause\r\n');
    return { cli, launcher: process.platform === 'win32' ? launcher : null };
  }
  return { summary, prepare, apply, installOfflineTool, folder, session:()=>readJSON(path.join(folder,'session.json'),{}) };
}
