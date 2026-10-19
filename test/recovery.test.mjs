import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findLeftovers,
  guardProfileWrites,
  installSpec,
  isNoopPlan,
  normalizePath,
  planRollback,
  safeModeTargets,
  selectDeletable,
} from '../lib/recovery.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_ROOT = path.join(ROOT, '.tmp');

function tempDir(label) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(TMP_ROOT, 'recovery-' + label + '-'));
}

test('planRollback separates removals from reinstallations', () => {
  const plan = planRollback(
    [{ name: 'keep', version: '1.0.0' }, { name: 'gone', version: '1.0.0' }, { name: 'moved', version: '2.0.0' }],
    [{ name: 'keep', version: '1.0.0' }, { name: 'moved', version: '1.0.0' }, { name: 'back', version: '3.0.0' }],
  );
  assert.deepEqual(plan.remove, ['gone']);
  assert.deepEqual(plan.install, [{ name: 'back', version: '3.0.0' }, { name: 'moved', version: '1.0.0' }]);
  assert.equal(plan.same, 1);
  assert.equal(isNoopPlan(plan), false);
});

test('planRollback is a no-op for the same inventory', () => {
  const list = [{ name: 'a', version: '1' }, { name: 'b', version: null }];
  const plan = planRollback(list, list);
  assert.equal(isNoopPlan(plan), true);
  assert.equal(plan.same, 2);
});

test('planRollback ignores malformed entries', () => {
  const plan = planRollback([{ name: 'ok', version: '1' }, { name: '../evil' }, null], [{ name: 'ok', version: '1' }]);
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.install, []);
  assert.equal(isNoopPlan(plan), true);
});

test('installSpec keeps exact versions, ranges and bare names', () => {
  assert.equal(installSpec({ name: 'pkg', version: '1.2.3' }), 'pkg@1.2.3');
  assert.equal(installSpec({ name: 'pkg', version: '^1.2.0' }), 'pkg@^1.2.0');
  assert.equal(installSpec({ name: 'pkg', version: null }), 'pkg');
  assert.equal(installSpec({ name: '@scope/pkg', version: '0.1.0' }), '@scope/pkg@0.1.0');
});

test('installSpec normalises local link specs so pnpm can parse them', () => {
  const bs = String.fromCharCode(92);
  // A Windows path inside name@link:... must use forward slashes.
  assert.equal(installSpec({ name: 'local', version: 'link:C:' + bs + 'dev' + bs + 'pkg' }), 'local@link:C:/dev/pkg');
  assert.equal(installSpec({ name: 'local', version: 'link:/home/u/pkg' }), 'local@link:/home/u/pkg');
  assert.equal(installSpec({ name: 'local', version: 'file:../local' }), 'local@file:../local');
  assert.equal(installSpec({ name: 'local', version: 'github:user/repo' }), 'local@github:user/repo');
});

test('planRollback treats a disabled bundle as a change', () => {
  const plan = planRollback(
    [{ name: 'on', version: '1', enabled: true }, { name: 'off', version: '1', enabled: false }],
    [{ name: 'on', version: '1', enabled: false }, { name: 'off', version: '1', enabled: true }],
  );
  assert.deepEqual(plan.enable, ['off']);
  assert.deepEqual(plan.disable, ['on']);
  assert.equal(plan.same, 0);
  assert.equal(isNoopPlan(plan), false);
});

test('safeModeTargets disables community bundles but never official ones or Bingo', () => {
  const targets = safeModeTargets([
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-bingo-ren',
    'dsh-pet',
    '@someone/skin',
    'dsh-pet',
  ]);
  assert.deepEqual(targets, ['@someone/skin', 'dsh-pet']);
  assert.deepEqual(safeModeTargets([]), []);
  assert.deepEqual(safeModeTargets(null), []);
});

test('guardProfileWrites reports a recent plugin operation as busy', () => {
  const dir = tempDir('guard');
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(path.join(logs, 'operation-abc'), { recursive: true });
  fs.writeFileSync(path.join(logs, 'operation-abc', 'pnpm.log'), 'working', 'utf8');
  const now = Date.now();
  assert.deepEqual(guardProfileWrites({ logsDir: logs, now }), { busy: true, reason: 'plugin-operation' });
  assert.equal(guardProfileWrites({ logsDir: logs, now: now + 10 * 60 * 1000 }).busy, false);
});

test('a permanent pnpm lock file must never be treated as busy', () => {
  const dir = tempDir('lock');
  const nodeModules = path.join(dir, 'node_modules');
  fs.mkdirSync(path.join(nodeModules, '.pnpm'), { recursive: true });
  fs.writeFileSync(path.join(nodeModules, '.pnpm', 'lock.yaml'), 'lockfileVersion: 9', 'utf8');
  // pnpm keeps this file forever after the first install. Treating it as an
  // active operation blocked rollback, safe mode and cleanup permanently.
  assert.deepEqual(guardProfileWrites({ logsDir: path.join(nodeModules, '.pnpm') }), { busy: false, reason: null });
  assert.deepEqual(guardProfileWrites({}), { busy: false, reason: null });
  assert.deepEqual(guardProfileWrites({ logsDir: path.join(dir, 'nope') }), { busy: false, reason: null });
});

test('findLeftovers collects only provable leftovers', () => {
  const dir = tempDir('leftovers');
  const nodeModules = path.join(dir, 'profile', 'node_modules');
  const dshHome = dir;
  fs.mkdirSync(path.join(nodeModules, '.ignored', 'old-name'), { recursive: true });
  fs.mkdirSync(path.join(nodeModules, 'half-installed_tmp_19580_14'), { recursive: true });

  const found = findLeftovers({ nodeModulesDir: nodeModules, dshHome, installedNames: ['kept-pkg'] });
  const kinds = found.map(item => item.kind + ':' + item.name).sort();
  assert.deepEqual(kinds, ['ignored:old-name', 'tmp:half-installed']);
  for (const item of found) assert.equal(path.isAbsolute(item.path), true);
});

test('findLeftovers never reports hoisted transitive dependencies', () => {
  // With nodeLinker: hoisted most node_modules entries are dependencies of
  // dependencies. Reporting them as orphans let cleanup delete the whole tree.
  const dir = tempDir('hoisted');
  const nodeModules = path.join(dir, 'profile', 'node_modules');
  for (const name of ['d3', 'cytoscape', 'commander', 'clsx', 'argparse']) {
    fs.mkdirSync(path.join(nodeModules, name), { recursive: true });
  }
  const found = findLeftovers({
    nodeModulesDir: nodeModules,
    dshHome: dir,
    installedNames: ['only-one-declared'],
  });
  assert.deepEqual(found, []);
});

test('findLeftovers only offers data dirs for packages the journal saw leave', () => {
  const dir = tempDir('data');
  const dshHome = dir;
  for (const name of ['electron', 'cache', 'our-free-model', 'gone-plugin']) {
    fs.mkdirSync(path.join(dshHome, name), { recursive: true });
  }
  // Without a removal record nothing is offered, even for an obvious leftover.
  assert.deepEqual(findLeftovers({ dshHome, installedNames: [] }), []);
  // With one, only the matching directory is offered.
  const found = findLeftovers({ dshHome, installedNames: [], removedNames: ['dsh-gone-plugin'] });
  assert.deepEqual(found.map(item => item.name + ':' + path.basename(item.path)), ['dsh-gone-plugin:gone-plugin']);
});

test('findLeftovers skips the live profile directory and keeps scoped containers', () => {
  const dir = tempDir('leftovers-profile');
  const dshHome = dir;
  const nodeModules = path.join(dir, 'profiles', 'desktop', 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.mkdirSync(path.join(nodeModules, '@scope', 'inner'), { recursive: true });
  const found = findLeftovers({
    nodeModulesDir: nodeModules,
    dshHome,
    profileDir: path.join(dir, 'profiles', 'desktop'),
    installedNames: [],
  });
  assert.equal(found.some(item => item.name === 'profiles'), false);
  assert.equal(found.some(item => item.name === '@scope'), false);
});

test('selectDeletable refuses unknown paths, links and files', () => {
  const dir = tempDir('delete');
  const good = path.join(dir, 'orphan');
  const linked = path.join(dir, 'linked');
  const file = path.join(dir, 'file.txt');
  fs.mkdirSync(good, { recursive: true });
  fs.mkdirSync(path.join(dir, 'target'), { recursive: true });
  fs.writeFileSync(file, 'x', 'utf8');
  try { fs.symlinkSync(path.join(dir, 'target'), linked, 'junction'); } catch { /* privilege */ }
  const candidates = [{ path: good }, { path: linked }, { path: file }];
  const result = selectDeletable({ candidates, requested: [good, linked, file, path.join(dir, 'unknown'), ''] });
  assert.deepEqual(result.allowed, [normalizePath(good)]);
  const reasons = result.refused.map(item => item.reason).sort();
  assert.equal(reasons.includes('not-a-known-leftover'), true);
  assert.equal(reasons.includes('not-a-directory'), true);
});
