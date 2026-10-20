import assert from 'node:assert/strict';
import test from 'node:test';
import { installSpec, isNoopPlan, planRollback } from '../lib/recovery.js';

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


test('rollback preserves unknown historical enablement and carries disabled state through reinstall', () => {
  const same=planRollback([{name:'example',version:'1',enabled:false}],[{name:'example',version:'1'}]);
  assert.equal(isNoopPlan(same),true,'old checkpoints cannot prove enablement');
  assert.equal(planRollback([{name:'example',version:'2',enabled:false}],[{name:'example',version:'1'}]).install[0].enabled,false);
  const update=planRollback([{name:'example',version:'2',enabled:true}],[{name:'example',version:'1',enabled:false}]);
  assert.deepEqual(update.install,[{name:'example',version:'1',enabled:false}]);
});
