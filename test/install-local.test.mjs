import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = path.join(root, '.tmp');
const shell = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'pwsh';

function fixture(t) {
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'uninstall-test-'));
  const profile = path.join(dir, 'profiles', 'test');
  fs.mkdirSync(profile, { recursive: true });
  const manifest = {
    dependencies: { original: '1', 'dsh-bingo-ren': '0.1.1', later: '2' },
    dsh: { profile: { bundles: ['original', 'dsh-bingo-ren', 'later'] } },
    custom: { preserve: true },
  };
  const file = path.join(profile, 'package.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  fs.writeFileSync(file + '.bingo-backup', JSON.stringify({ dependencies: { original: '1' } }));
  t.after(() => {
    if (!path.resolve(dir).startsWith(path.resolve(base) + path.sep)) throw new Error('Unsafe fixture cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, profile, file, manifest };
}

function uninstall(f, ...options) {
  const result = spawnSync(shell, [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'install-local-desktop.ps1'),
    '-DshHome', f.dir, '-ProfileName', 'test', '-Force', '-Uninstall', ...options,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
}

test('local uninstall preserves plugins added since the backup', t => {
  const f = fixture(t);
  uninstall(f);
  const after = JSON.parse(fs.readFileSync(f.file));
  assert.deepEqual(after.dependencies, { original: '1', later: '2' });
  assert.deepEqual(after.dsh.profile.bundles, ['original', 'later']);
  assert.deepEqual(after.custom, { preserve: true });
  assert.ok(fs.existsSync(f.file + '.bingo-backup'));
});

test('local uninstall WhatIf leaves the manifest unchanged', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file, 'utf8');
  uninstall(f, '-WhatIf');
  assert.equal(fs.readFileSync(f.file, 'utf8'), before);
});

test('local uninstall unlinks a junction without deleting its source', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const source = path.join(f.dir, 'checkout');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'keep.txt'), 'keep');
  const modules = path.join(f.profile, 'node_modules');
  fs.mkdirSync(modules);
  const link = path.join(modules, 'dsh-bingo-ren');
  fs.symlinkSync(source, link, 'junction');
  uninstall(f);
  assert.equal(fs.existsSync(link), false);
  assert.equal(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8'), 'keep');
});
