import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRescue } from '../lib/rescue.js';
import { createQuarantine } from '../lib/quarantine.js';
import { createStartupHealth } from '../lib/health.js';
import { withProfileLock, packageRunBusy } from '../lib/local-state.js';

function fixture(t) {
  const base=path.resolve('.tmp');fs.mkdirSync(base,{recursive:true});
  const home=fs.mkdtempSync(path.join(base,'support-'));const profile=path.join(home,'profiles','desktop');const state=path.join(home,'bingo');
  fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(state);
  const manifest={name:'fixture',dependencies:{'dsh-bingo-ren':'1','community':'2'},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@deepseek-ai/optional','community','dsh-bingo-ren']}}};
  fs.writeFileSync(path.join(profile,'package.json'),JSON.stringify(manifest,null,4)+'\n');
  fs.writeFileSync(path.join(profile,'cordis.patch.yml'),'# keep this comment\n- id: custom\n  disabled: false\n');
  t.after(()=>{assert.ok(home.startsWith(base+path.sep));fs.rmSync(home,{recursive:true,force:true});});
  const rescue=()=>createRescue({profileDir:profile,stateDir:state});
  const quarantine=(removed=[])=>createQuarantine({profileDir:profile,dshHome:home,stateDir:state,removedNames:()=>removed});
  const make=relative=>{const folder=path.join(home,relative);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'keep.txt'),'original');const old=new Date(Date.now()-3600000);fs.utimesSync(folder,old,old);return folder;};
  return {home,profile,state,manifest,rescue,quarantine,make};
}

test('minimal boot is staged, then applied only after exit, with exact restoration',t=>{
  const f=fixture(t), rescue=f.rescue();const pkg=path.join(f.profile,'package.json'),patch=path.join(f.profile,'cordis.patch.yml');
  const original=fs.readFileSync(pkg),originalPatch=fs.readFileSync(patch);
  const task=rescue.prepare('enter');assert.deepEqual(fs.readFileSync(pkg),original);
  assert.throws(()=>rescue.apply(task,{closed:true,hostPid:process.pid}),{code:'application-still-running'});
  assert.deepEqual(fs.readFileSync(patch),originalPatch);
  rescue.apply(task,{closed:true});
  const changed=JSON.parse(fs.readFileSync(pkg));
  assert.deepEqual(changed.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-bingo-ren']);
  assert.equal(changed.dependencies.community,'2');assert.equal(fs.readFileSync(patch,'utf8'),'[]\n');
  assert.equal(rescue.summary().phase,'active');
  const restore=f.rescue().prepare('restore');f.rescue().apply(restore,{closed:true});
  assert.deepEqual(fs.readFileSync(pkg),original);assert.deepEqual(fs.readFileSync(patch),originalPatch);
  assert.equal(fs.existsSync(path.join(f.profile,'cordis.patch.yaml')),false);
  assert.equal(f.rescue().summary().active,false);
});

test('restore preserves changes made after entering minimal mode',t=>{
  const f=fixture(t), rescue=f.rescue();rescue.apply(rescue.prepare('enter'),{closed:true});
  const patch=path.join(f.profile,'cordis.patch.yml');fs.writeFileSync(patch,'# new edit\n[]\n');
  assert.throws(()=>rescue.prepare('restore'),{code:'configuration-changed'});
  assert.equal(fs.readFileSync(patch,'utf8'),'# new edit\n[]\n');
});

test('interrupted minimal boot can restore mixed known files without losing comments',t=>{
  const f=fixture(t),rescue=f.rescue();const patch=path.join(f.profile,'cordis.patch.yml');const original=fs.readFileSync(patch,'utf8');
  rescue.prepare('enter');fs.writeFileSync(patch,'[]\n');
  rescue.apply(rescue.prepare('restore'),{closed:true});assert.equal(fs.readFileSync(patch,'utf8'),original);
});

test('a failed multi-file apply rolls back files and retains readable backup',t=>{
  const f=fixture(t),rescue=f.rescue();const task=rescue.prepare('enter');const patch=path.join(f.profile,'cordis.patch.yml');
  const before=fs.readFileSync(path.join(f.profile,'package.json'));const originalRename=fs.renameSync;let fail=true;
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===patch&&fail){fail=false;throw Object.assign(new Error('blocked'),{code:'EACCES'});}return originalRename(from,to);});
  assert.throws(()=>rescue.apply(task,{closed:true}),{code:'EACCES'});
  assert.deepEqual(fs.readFileSync(path.join(f.profile,'package.json')),before);
  assert.equal(fs.readFileSync(path.join(rescue.summary().backupDir,'cordis.patch.yml'),'utf8'),'# keep this comment\n- id: custom\n  disabled: false\n');
});

test('minimal mode refuses nonstandard layouts, linked config and stale tasks',t=>{
  const f=fixture(t),rescue=f.rescue();const task=rescue.prepare('enter');
  assert.throws(()=>rescue.apply({...task,id:'wrong'},{closed:true}),{code:'stale-rescue-task'});
  rescue.apply(task,{closed:true});rescue.apply(rescue.prepare('restore'),{closed:true});
  const pkg=path.join(f.profile,'package.json');fs.writeFileSync(pkg,'{"dependencies":{}}');
  assert.throws(()=>rescue.prepare('enter'),{code:'unsupported-profile-layout'});
  const outside=f.make('external-config');
  fs.unlinkSync(path.join(f.profile,'cordis.patch.yml'));fs.symlinkSync(outside,path.join(f.profile,'cordis.patch.yml'),'junction');
  assert.throws(()=>rescue.prepare('enter'),{code:'linked-path'});assert.equal(fs.readFileSync(path.join(outside,'keep.txt'),'utf8'),'original');
});

test('independent recovery copy can inspect status without the installed package',t=>{
  const f=fixture(t),rescue=f.rescue();
  const tool=rescue.installOfflineTool({moduleDir:path.resolve('lib'),execPath:process.execPath});
  assert.ok(fs.existsSync(tool.cli));assert.ok(fs.existsSync(path.join(path.dirname(tool.cli),'local-state.js')));
  const result=spawnSync(process.execPath,[tool.cli,'status','--profile',f.profile,'--state',f.state],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).active,false);
});

test('native writer lock and surviving package runs block recovery',t=>{
  const f=fixture(t);
  fs.mkdirSync(path.join(f.profile,'node_modules/.pnpm'),{recursive:true});
  fs.writeFileSync(path.join(f.profile,'node_modules/.pnpm/lock.yaml'),'lockfileVersion: 9');
  assert.equal(withProfileLock(f.profile,()=>true),true,'persistent pnpm lock is not a running operation');
  fs.writeFileSync(path.join(f.profile,'package.json.lock'),process.pid+'\n');
  assert.throws(()=>f.rescue().prepare('enter'),{code:'profile-busy'});
  fs.unlinkSync(path.join(f.profile,'package.json.lock'));
  fs.mkdirSync(path.join(f.profile,'.plugin-manager'));fs.writeFileSync(path.join(f.profile,'.plugin-manager/run.json'),JSON.stringify({pid:process.pid,grouped:false}));
  assert.equal(packageRunBusy(f.profile),true);assert.throws(()=>withProfileLock(f.profile,()=>true),{code:'plugin-operation'});
});

test('native stale PID locks are reclaimed, but corrupt locks are retained',t=>{
  const f=fixture(t);const lock=path.join(f.profile,'package.json.lock');
  fs.writeFileSync(lock,'2147483646\n');assert.equal(withProfileLock(f.profile,()=>true),true);assert.equal(fs.existsSync(lock),false);
  fs.writeFileSync(lock,'not-a-pid');assert.throws(()=>withProfileLock(f.profile,()=>true),{code:'profile-busy'});assert.equal(fs.readFileSync(lock,'utf8'),'not-a-pid');
});

test('only old, unlinked leftovers are offered; live temporary runs are excluded',t=>{
  const f=fixture(t);f.make('profiles/desktop/node_modules/.ignored/old');f.make('profiles/desktop/node_modules/@scope/half_tmp_2147483646_1');
  for(const name of ['commander','clsx','argparse'])f.make('profiles/desktop/node_modules/'+name);
  f.make('profiles/desktop/node_modules/active_tmp_'+process.pid+'_1');
  fs.mkdirSync(path.join(f.profile,'node_modules/new_tmp_2147483646_2'));
  const q=f.quarantine();assert.deepEqual(q.scan().map(x=>x.kind).sort(),['ignored','tmp']);
  const target=path.join(f.profile,'node_modules/.ignored/old');
  fs.symlinkSync(target,path.join(f.profile,'node_modules/community'),'junction');
  assert.equal(q.scan().some(x=>x.path===target),false);
});

test('quarantine move, collision-safe restore, and explicit purge work without deleting other paths',t=>{
  const f=fixture(t);const original=f.make('profiles/desktop/node_modules/.ignored/old');const q=f.quarantine();const candidate=q.scan()[0];
  assert.throws(()=>q.isolate([candidate.id,'unknown']),{code:'stale-cleanup-scan'});assert.ok(fs.existsSync(original));
  const moved=q.isolate([candidate.id]);assert.equal(fs.existsSync(original),false);const id=moved.isolated[0];assert.equal(q.list()[0].status,'isolated');
  fs.mkdirSync(original);assert.throws(()=>q.change('restore',id),{code:'restore-path-occupied'});fs.rmdirSync(original);
  q.change('restore',id);assert.equal(fs.readFileSync(path.join(original,'keep.txt'),'utf8'),'original');
  const next=q.isolate([q.scan()[0].id]);q.change('purge',next.isolated[0]);assert.deepEqual(q.list(),[]);
  assert.throws(()=>q.change('purge','../../external'),{code:'invalid-selection'});
});

test('data directories require removal history, exact name and absence from every profile',t=>{
  const f=fixture(t);f.make('gone');f.make('dsh-gone');f.make('cache');
  assert.equal(f.quarantine().scan().some(x=>x.kind==='data'),false);
  const other=path.join(f.home,'profiles/other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'package.json'),JSON.stringify({dependencies:{'dsh-gone':'1'}}));
  assert.equal(f.quarantine(['dsh-gone']).scan().some(x=>x.kind==='data'),false);
  fs.writeFileSync(path.join(other,'package.json'),'{}');
  assert.deepEqual(f.quarantine(['dsh-gone','cache']).scan().filter(x=>x.kind==='data').map(x=>path.basename(x.path)),['dsh-gone']);
});

test('quarantine refuses linked ancestors and never follows them',t=>{
  const f=fixture(t);const outside=f.make('outside/old');fs.mkdirSync(path.join(f.profile,'node_modules'));
  fs.symlinkSync(path.join(f.home,'outside'),path.join(f.profile,'node_modules/.ignored'),'junction');
  assert.deepEqual(f.quarantine().scan(),[]);assert.ok(fs.existsSync(path.join(outside,'keep.txt')));
});

test('startup health measures every boot at a named checkpoint and records association without attribution',t=>{
  const f=fixture(t);let time=1000;
  const options={profileDir:f.profile,stateDir:f.state,version:'0.5.0',now:()=>time,hostStartedAt:0};
  const first=createStartupHealth({...options,boot:'a'});first.begin([{name:'old',version:'1'}]);first.begin([]);
  assert.equal(first.report().items.length,1);assert.equal(first.report().items[0].hostToUiMs,null);
  time=3100;first.ready({plugins:[{enabled:true,fiberPhase:'active'},{enabled:true,fiberPhase:'failed'}]});
  first.ready({plugins:[]});assert.equal(first.report().items[0].failedCount,1);
  time=10000;const next=createStartupHealth({...options,boot:'b',hostStartedAt:10000});next.begin([{name:'old',version:'1'},{name:'dsh-pet',version:'1'}]);
  time=15800;next.ready(null);
  const report=next.report();assert.equal(report.items[0].hostToUiMs,5800);assert.equal(report.items[0].failedCount,null);
  assert.equal(report.items[0].changes[0].name,'dsh-pet');assert.equal(report.stats.averageMs,4450);
  assert.match(report.note,/不代表因果关系/);
});

test('health uses monotonic elapsed time and keeps minimal boots out of normal averages',t=>{
  const f=fixture(t);const options={profileDir:f.profile,stateDir:f.state,now:()=>999999,hostStartedAt:0,version:'0.5.0',elapsed:()=>2200};
  const health=createStartupHealth({...options,boot:'normal'});health.begin([]);health.ready(null);
  const safe=createStartupHealth({...options,boot:'safe',elapsed:()=>900});safe.begin([],{minimal:true});
  // Inventory lookup may finish later; timing stays at UI acknowledgement receipt.
  safe.ready(null,{observedAt:500,elapsedMs:500});
  assert.equal(safe.report().items[0].readyAt,new Date(500).toISOString());
  assert.equal(safe.report().stats.averageMs,2200);assert.equal(safe.report().stats.count,1);assert.equal(safe.report().items[0].hostToUiMs,500);
});
