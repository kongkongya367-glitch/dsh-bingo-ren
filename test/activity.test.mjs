import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createActivityJournal, diffInventory, buildAcceptance, readHostInventory } from '../lib/activity.js';

function fixture(t) {
  const base = path.resolve('.tmp');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'activity-test-'));
  t.after(() => {
    if (!dir.startsWith(base + path.sep)) throw new Error('Unsafe cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const options = { stateDir: path.join(dir, 'state'), profileDir: path.join(dir, 'profile'), boot: 'boot-1' };
  const open = override => createActivityJournal({ ...options, ...override });
  return { dir, options, open };
}
const packages = [{ name: 'example-plugin', version: '^1.0.0' }];

test('inventory diffs distinguish addition, declared version change, and removal', () => {
  assert.deepEqual(diffInventory([{ name: 'a', version: '1' }, { name: 'b', version: null }], [{ name: 'a', version: '2' }, { name: 'c', version: '3' }]), [
    { kind: 'updated', name: 'a', from: '1', to: '2' },
    { kind: 'removed', name: 'b', from: null, to: null },
    { kind: 'added', name: 'c', from: null, to: '3' },
  ]);
});

test('initial baseline is quiet; changes survive restart without duplication', t => {
  const f = fixture(t); const a = f.open();
  a.observe([]); assert.equal(a.view().history.length, 0);
  a.observe(packages); assert.equal(a.view().history[0].kind, 'added');
  const b = f.open({ boot: 'boot-2' }); b.observe(packages, 'startup');
  assert.equal(b.view().history.length, 1);
  b.observe([{ name: 'example-plugin', version: '^2.0.0' }], 'startup');
  assert.equal(b.view().history[0].source, 'startup');
  assert.equal(b.view().history[0].kind, 'updated');
  b.observe([]); assert.equal(b.view().history[0].kind, 'removed');
});

test('profiles have separate history and trial files', t => {
  const f = fixture(t); const a = f.open(); a.observe(packages); a.trial('start', packages[0]);
  const b = f.open({ profileDir: path.join(f.dir, 'other-profile') }); b.observe([]);
  assert.notEqual(a.file, b.file); assert.equal(b.view().trials.length, 0);
});

test('trials review on next boot, snooze for this boot, and keep permanently', t => {
  const f = fixture(t); const a = f.open(); a.observe(packages);
  assert.deepEqual(a.trial('start', packages[0]), { ok: true });
  assert.equal(a.summary().reviewCount, 0);
  const b = f.open({ boot: 'boot-2' }); b.observe(packages);
  assert.equal(b.summary().reviewCount, 1);
  const trial = b.view().trials[0];
  b.trial('snooze', trial); assert.equal(b.summary().reviewCount, 0);
  assert.equal(f.open({ boot: 'boot-2' }).summary().reviewCount, 0);
  const c = f.open({ boot: 'boot-3' }); assert.equal(c.summary().reviewCount, 1);
  assert.equal(c.trial('keep', { ...trial, id: 'stale' }).ok, false);
  c.trial('keep', trial); assert.equal(f.open({ boot: 'boot-4' }).view().trials.length, 0);
});

test('replacement versions require re-marking and removed packages end trials', t => {
  const f = fixture(t); const a = f.open(); a.observe(packages); a.trial('start', packages[0]);
  const previous = a.view().trials[0];
  a.observe([{ name: 'example-plugin', version: '2' }]);
  assert.equal(a.view().trials[0].versionChanged, true);
  assert.equal(a.trial('start', packages[0]).code, 'version-changed');
  a.trial('start', { name: 'example-plugin', version: '2' });
  assert.notEqual(a.view().trials[0].id, previous.id);
  assert.equal(a.view().trials[0].versionChanged, false);
  a.observe([]); assert.equal(a.view().trials.length, 0);
});

test('Bingo cannot trial-remove itself and history retention is bounded', t => {
  const f = fixture(t); const a = f.open();
  a.observe([{ name: 'dsh-bingo-ren', version: '0.2.0' }]);
  assert.equal(a.trial('start', { name: 'dsh-bingo-ren' }).ok, false);
  for (let i = 0; i < 205; i++) a.observe([{ name: 'example-plugin', version: String(i) }]);
  assert.equal(a.summary().historyCount, 200);
  assert.equal(a.view().history.length, 100);
});

test('invalid persisted data recovers, while failed writes do not report success', t => {
  const f = fixture(t); const a = f.open(); a.observe([]);
  fs.writeFileSync(a.file, 'null'); assert.equal(f.open().view().history.length, 0);
  const blocked = path.join(f.dir, 'not-a-directory'); fs.writeFileSync(blocked, '');
  const b = f.open({ stateDir: blocked }); assert.throws(() => b.observe(packages));
  assert.equal(b.view().packages.length, 0);
});

test('acceptance uses every declared live row and never treats files as activation', () => {
  const targets = ['active', 'failed', 'disabled', 'partial', 'unknown', 'no-manager'].map(name => ({ name, version: '^1' }));
  const result = buildAcceptance(targets, { bundles: [
    { name: 'active', enabled: true, version: '1.2.0', rows: [{ entryId: 'a' }, { entryId: 'off' }] },
    { name: 'failed', enabled: true, error: { code: 'activation' } },
    { name: 'disabled', enabled: false },
    { name: 'partial', enabled: true, rows: [{ entryId: 'a' }, { entryId: 'missing' }] },
    { name: 'unknown', enabled: true, rows: [] },
  ], plugins: [{ entryId: 'a', enabled: true, fiberPhase: 'active' }, { entryId: 'off', enabled: false, fiberPhase: null }] });
  assert.deepEqual(result.map(r => r.state), ['active', 'failed', 'disabled', 'pending', 'unknown', 'unknown']);
  assert.equal(result[0].installedVersion, '1.2.0');
  assert.equal(buildAcceptance(targets, null).every(r => r.state === 'unknown'), true);
  assert.equal(buildAcceptance([targets[0]], { bundles: [{ name: 'active', rows: [{ entryId: 'a' }] }], plugins: [{ entryId: 'a', enabled: true, fiberPhase: 'failed' }] })[0].state, 'failed');
});

test('unavailable or timing-out host inventory remains unknown', async () => {
  assert.equal(await readHostInventory(null), null);
  assert.equal(await readHostInventory({ listBundles() { throw new Error('offline'); } }), null);
  assert.equal(await readHostInventory({ listBundles: () => new Promise(() => {}) }, 5), null);
});


test('enablement changes survive checkpoints and old journals gain a baseline without fabricated changes', t => {
  const f=fixture(t), old=f.open();old.observe([{name:'example',version:'1'}]);
  const migrated=f.open();migrated.observe([{name:'example',version:'1',enabled:false}]);
  assert.equal(migrated.view().history.length,0);assert.equal(migrated.view().checkpoints.length,0);
  migrated.observe([{name:'example',version:'1',enabled:true}]);
  assert.equal(migrated.view().history[0].kind,'enabled');
  const cp=migrated.checkpointById(migrated.view().checkpoints[0].id);
  assert.equal(cp.packages[0].enabled,false);
  const reopened=f.open();assert.equal(reopened.checkpointById(cp.id).packages[0].enabled,false);
  reopened.observe([{name:'example',version:'1',enabled:false}]);assert.equal(reopened.view().history[0].kind,'disabled');
});

test('full plugin list can expose failures outside the recent thirty-item acceptance list', () => {
  const packages=Array.from({length:40},(_,i)=>({name:'plugin-'+i,version:'1'}));
  const inventory={bundles:[{name:'plugin-39',error:{code:'failed'}}],plugins:[]};
  assert.equal(buildAcceptance(packages,inventory).length,30);
  const all=buildAcceptance(packages,inventory,1000);
  assert.equal(all.length,40);assert.equal(all[39].state,'failed');
});
