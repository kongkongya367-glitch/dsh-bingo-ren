/** Plugin history/trials and recovery operations. Host lifecycle stays in index.js. */
import fs from 'node:fs';
import path from 'node:path';
import { createActivityJournal, buildAcceptance, readHostInventory } from './activity.js';
import { createRescue } from './rescue.js';
import { createQuarantine } from './quarantine.js';
import { createStartupHealth } from './health.js';
import { profileKey, packageRunBusy, profileWriterBusy, writeJSON } from './local-state.js';
import { planRollback, isNoopPlan, installSpec } from './recovery.js';
import { MODULE_DIR, listPackages, messageOf, readJsonFile, resolveDshHome, sendJson, readJsonBody } from './host-support.js';

const SELF_NAME = 'dsh-bingo-ren';
// Shared across Cordis recompositions so an old async operation cannot lose its lock.
const ACTIVITY_CACHE = globalThis.__DSH_BINGO_ACTIVITY_CACHE__ || (globalThis.__DSH_BINGO_ACTIVITY_CACHE__ = new Map());

export function createPluginManagement({
  hostCtx, env, stateDir, version, runtimeToken, sameBoot, canRestart, deps, now, clock,
  getProfileDir, ensureProfile, readProfileManifest, scheduleRestart, registerRoute, debug, event, isRestarting,
}) {
  let journal = null;
  let journalProfile = null;
  let activityWarning = null;
  let removingTrial = false;
  let recoveryBusy = false;
  const legacyStatePath = () => path.join(stateDir, 'safe-mode-' + profileKey(getProfileDir()) + '.json');
  let support = null;
  let supportProfile = null;
  function supportTools() {
    const profileDir = getProfileDir();
    if (!support || supportProfile !== profileDir) {
      const rescue = createRescue({profileDir,stateDir,now});
      support = {rescue,
        quarantine:createQuarantine({profileDir,stateDir,dshHome:resolveDshHome(env),removedNames:()=>activity().removedNames(),now}),
        health:createStartupHealth({profileDir,stateDir,boot:runtimeToken,version,now,hostStartedAt:now()-process.uptime()*1000,elapsed:()=>process.uptime()*1000})};
      supportProfile=profileDir;
      try {
        support.offline=rescue.installOfflineTool({moduleDir:MODULE_DIR,execPath:deps.execPath||process.execPath,electron:Boolean(process.versions.electron)});
      } catch(error) { debug('offline tool setup failed: '+messageOf(error)); }
    }
    return support;
  }
  function recordBoot(manifest) {
    try {
      const tools=supportTools();
      tools.health.begin(listPackages(manifest),{minimal:tools.rescue.summary().phase==='active',lateObservation:sameBoot||process.uptime()>120});
    } catch(error) { debug('startup health write failed: '+messageOf(error)); }
  }

  function activity() {
    const profileDir = getProfileDir();
    if (!journal || journalProfile !== profileDir) {
      let canonicalProfile;
      try { canonicalProfile = fs.realpathSync.native(profileDir); } catch { canonicalProfile = path.resolve(profileDir); }
      if (process.platform === 'win32') canonicalProfile = canonicalProfile.toLowerCase();
      const key = JSON.stringify([path.resolve(stateDir), canonicalProfile, runtimeToken, version]);
      journal = ACTIVITY_CACHE.get(key);
      if (!journal) {
        journal = createActivityJournal({ stateDir, profileDir, boot: runtimeToken, now });
        ACTIVITY_CACHE.set(key, journal);
        if (ACTIVITY_CACHE.size > 32) ACTIVITY_CACHE.delete(ACTIVITY_CACHE.keys().next().value);
      }
      journalProfile = profileDir;
    }
    return journal;
  }

  function observeActivity(manifest, source) {
    try {
      activity().observe(listPackages(manifest), source);
      activityWarning = null;
    } catch (error) {
      activityWarning = '插件记录暂时无法保存，请检查状态目录权限。';
      debug('activity write failed: ' + messageOf(error));
    }
  }

  function pluginManager() {
    try { return hostCtx?.get?.('pluginManager') || null; } catch { return null; }
  }

  async function activityView() {
    ensureProfile();
    const manifest = readProfileManifest();
    if (manifest) observeActivity(manifest, 'running');
    const view = activity().view();
    const manager = pluginManager();
    const inventory = await readHostInventory(manager);
    return { ok: true, ...view, warning: activityWarning,
      canRemove: Boolean(inventory && typeof manager?.removeBundle === 'function'),
      trials: view.trials.map(t => ({ ...t, removable: !t.versionChanged && inventory?.bundles?.some(b => b.name === t.name && b.removable === true) === true })),
      acceptance: buildAcceptance(view.targets, inventory),
    };
  }

  /** Why Bingo must not start a package operation right now. */
  function writeGuard() {
    const profileDir = getProfileDir();
    if (busy()) return { busy: true, reason: 'operation-busy' };
    if (profileWriterBusy(profileDir) || packageRunBusy(profileDir)) return {busy:true,reason:'plugin-operation'};
    return {busy:false,reason:null};
  }

  function readLegacySafeMode(file = legacyStatePath()) {
    const raw = readJsonFile(file);
    if (!raw || typeof raw !== 'object') return null;
    return {
      at: typeof raw.at === 'string' ? raw.at : null,
      applied: raw.applied === true,
      disabled: Array.isArray(raw.disabled) ? raw.disabled.filter(x => typeof x === 'string').slice(0, 200) : [],
    };
  }

  /** Restore an existing record only. New minimal boots use createRescue. */
  async function restoreLegacySafeMode() {
    const profileDir = getProfileDir();
    const file = legacyStatePath();
    const active = readLegacySafeMode(file);
    if (!active) return { status: 409, body: { ok: false, code: 'not-in-safe-mode' } };
    const failures = [];
    if (active.disabled.length) {
      const manager = pluginManager();
      if (!manager || typeof manager.setBundleEnabled !== 'function') {
        return { status: 409, body: { ok: false, code: 'manager-unavailable' } };
      }
      for (const name of active.disabled) {
        ensureProfile();
        if (getProfileDir() !== profileDir) {
          failures.push({ name, code: 'profile-changed' });
          continue;
        }
        try {
          const result = await manager.setBundleEnabled(name, true);
          if (!result || result.application === 'failed' || result.application === 'cancelled') {
            failures.push({ name, code: result?.error?.code || 'enable-refused' });
          }
        } catch (error) {
          failures.push({ name, code: messageOf(error) });
        }
      }
    }
    try {
      if (failures.length) writeJSON(file, { ...active, disabled: failures.map(f => f.name) });
      else fs.rmSync(file, { force: true });
    } catch {
      return { status: 503, body: { ok: false, code: 'state-unwritable', failures } };
    }
    if (getProfileDir() === profileDir) {
      const after = readProfileManifest();
      if (after) observeActivity(after, 'running');
    }
    event('safe mode exit: restored ' + (active.disabled.length - failures.length) + '/' + active.disabled.length);
    return {
      status: failures.length ? 409 : 200,
      body: {
        ok: failures.length === 0,
        cleared: failures.length ? [] : active.disabled,
        failures,
        restartRequired: failures.length === 0 && active.disabled.length > 0,
      },
    };
  }

  function recoverableView() {
    const journal = activity();
    const view = journal.view();
    const tools=supportTools();
    return {
      ok: true,
      safeMode: readLegacySafeMode(),
      busy: writeGuard(),
      checkpoints: view.checkpoints,
      packages: view.packages,
      rescue:{...tools.rescue.summary(),available:canRestart,offline:tools.offline||null},
      quarantine:tools.quarantine.list(),
      // Review candidates conservatively; moves are recoverable until purged.
      leftovers:tools.quarantine.scan(),
    };
  }

  /** Apply one checkpoint: restore versions, enablement and removed packages. */
  async function applyRollback(target) {
    const manager = pluginManager();
    if (!manager || typeof manager.setBundleEnabled !== 'function') {
      return { status: 409, body: { ok: false, code: 'manager-unavailable' } };
    }
    const selfName = SELF_NAME;
    const before = readProfileManifest();
    const current = listPackages(before || {});
    const plan = planRollback(current, target.packages);
    if (isNoopPlan(plan)) return { status: 200, body: { ok: true, changed: false, plan } };
    activity().checkpoint('before-rollback', current);
    const failures = [];
    for (const name of plan.remove) {
      if (name === selfName) continue;
      try {
        const result = await manager.removeBundle(name);
        if (result && (result.application === 'failed' || result.application === 'cancelled')) {
          failures.push({ name, code: result?.error?.code || 'remove-refused' });
        }
      } catch (error) { failures.push({ name, code: messageOf(error) }); }
    }
    for (const entry of plan.install) {
      try {
        const result = await manager.installBundle(installSpec(entry), { enabled: true, saveExact: true });
        if (result && result.error) failures.push({ name: entry.name, code: result.error.code || 'install-failed' });
      } catch (error) { failures.push({ name: entry.name, code: messageOf(error) }); }
    }
    for (const name of plan.enable || []) {
      if (name === selfName) continue;
      try {
        const result = await manager.setBundleEnabled(name, true);
        if (result && (result.application === 'failed' || result.application === 'cancelled')) failures.push({ name, code: 'enable-refused' });
      } catch (error) { failures.push({ name, code: messageOf(error) }); }
    }
    for (const name of plan.disable || []) {
      if (name === selfName) continue;
      try {
        const result = await manager.setBundleEnabled(name, false);
        if (result && (result.application === 'failed' || result.application === 'cancelled')) failures.push({ name, code: 'disable-refused' });
      } catch (error) { failures.push({ name, code: messageOf(error) }); }
    }
    const after = readProfileManifest();
    if (after) observeActivity(after, 'running');
    event('rollback applied: -' + plan.remove.length + ' +' + plan.install.length
      + ' on=' + (plan.enable || []).length + ' off=' + (plan.disable || []).length
      + ' failures=' + failures.length);
    return { status: failures.length ? 409 : 202,
      body: { ok: failures.length === 0, plan, failures, restartRequired: true } };
  }



  function busy() {
    return removingTrial || recoveryBusy || Boolean(activity().removing || activity().recovering);
  }

  async function runRecovery(operation) {
    const store = activity();
    recoveryBusy = true;
    store.recovering = true;
    try {
      return await operation();
    } finally {
      recoveryBusy = false;
      store.recovering = false;
    }
  }

  function registerRoutes() {
    registerRoute('GET', '/bingo/activity', async (req, res) => {
      sendJson(res, 200, await activityView());
    });

    registerRoute('POST', '/bingo/trials', async (req, res) => {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, code: parsed.code });
      ensureProfile();
      const manifest = readProfileManifest();
      if (!manifest) return sendJson(res, 409, { ok: false, code: 'manifest-unavailable' });
      observeActivity(manifest, 'running');
      if (activityWarning) return sendJson(res, 503, { ok: false, code: 'state-unwritable' });
      if (isRestarting() || busy()) return sendJson(res, 409, { ok: false, code: 'operation-busy' });
      const body = parsed.value;
      const store = activity();
      if (body.action !== 'remove') {
        if (!['start', 'keep', 'snooze'].includes(body.action)) return sendJson(res, 400, { ok: false, code: 'invalid-action' });
        const result = store.trial(body.action, body);
        return sendJson(res, result.ok ? 200 : 409, result);
      }
      const trial = store.view().trials.find(t => t.name === body.name && t.id === body.id);
      if (body.confirmed !== true) return sendJson(res, 400, { ok: false, code: 'confirmation-required' });
      if (!trial) return sendJson(res, 409, { ok: false, code: 'trial-changed' });
      if (trial.versionChanged) return sendJson(res, 409, { ok: false, code: 'version-changed' });
      const targetProfile = getProfileDir();
      removingTrial = true;
      store.removing = true;
      try {
        const manager = pluginManager();
        const inventory = await readHostInventory(manager);
        const bundle = inventory?.bundles?.find(b => b.name === trial.name);
        if (!manager || typeof manager.removeBundle !== 'function' || !inventory) {
          return sendJson(res, 409, { ok: false, code: 'manager-unavailable' });
        }
        if (!bundle || bundle.removable !== true || trial.name === SELF_NAME) {
          return sendJson(res, 409, { ok: false, code: 'not-removable' });
        }
        ensureProfile();
        const latest = readProfileManifest();
        if (getProfileDir() !== targetProfile || !latest || listPackages(latest).find(p => p.name === trial.name)?.version !== trial.version) {
          return sendJson(res, 409, { ok: false, code: 'version-changed' });
        }
        // Native manager owns locking, protected bundles, dependencies and HMR.
        const result = await manager.removeBundle(trial.name);
        if (!result || result.application === 'failed' || result.application === 'cancelled') {
          return sendJson(res, 409, { ok: false, code: 'native-remove-refused', reason: result?.error?.code || null });
        }
        const remaining = readJsonFile(path.join(targetProfile, 'package.json'));
        if (!remaining || listPackages(remaining).some(p => p.name === trial.name)) {
          return sendJson(res, 409, { ok: false, code: 'removal-incomplete' });
        }
        store.trial('removed', body);
        store.observe(listPackages(remaining), 'running');
        sendJson(res, 200, { ok: true, restartRequired: result.application === 'restart-required' });
      } catch (error) {
        debug('native trial removal failed: ' + messageOf(error));
        sendJson(res, 500, { ok: false, code: 'remove-failed' });
      } finally {
        removingTrial = false;
        store.removing = false;
      }
    });


    registerRoute('GET', '/bingo/health', async (req,res) => {
      ensureProfile(); sendJson(res,200,supportTools().health.report());
    });
    registerRoute('POST', '/bingo/ready', async (req,res) => {
      const body=await readJsonBody(req);
      if(!body.ok)return sendJson(res,body.status,{ok:false,code:body.code});
      ensureProfile();
      const profileDir=getProfileDir();
      if(body.value.bootId && body.value.bootId!==runtimeToken+':'+profileKey(profileDir))return sendJson(res,409,{ok:false,code:'profile-changed'});
      const tools=supportTools();const profile=profileDir;
      const observation={observedAt:now(),elapsedMs:process.uptime()*1000};
      const inventory=await readHostInventory(pluginManager());
      ensureProfile();if(profile!==getProfileDir())return sendJson(res,409,{ok:false,code:'profile-changed'});
      tools.health.ready(inventory,observation);sendJson(res,200,{ok:true});
    });
    registerRoute('POST', '/bingo/rescue', async (req,res) => {
      const parsed=await readJsonBody(req);
      if(!parsed.ok)return sendJson(res,parsed.status,{ok:false,code:parsed.code});
      ensureProfile();const body=parsed.value;
      if(body.confirmed!==true)return sendJson(res,400,{ok:false,code:'confirmation-required'});
      if(body.action==='restore-legacy') {
        if(isRestarting())return sendJson(res,409,{ok:false,code:'restarting'});
        const guard=writeGuard();if(guard.busy)return sendJson(res,409,{ok:false,code:guard.reason});
        const result = await runRecovery(restoreLegacySafeMode);
        return sendJson(res, result.status, result.body);
      }
      if(!canRestart)return sendJson(res,409,{ok:false,code:'unsupported'});
      if(isRestarting())return sendJson(res,409,{ok:false,code:'restarting'});
      const guard=writeGuard();if(guard.busy)return sendJson(res,409,{ok:false,code:guard.reason});
      try {
        const task=supportTools().rescue.prepare(body.action);
        const result=scheduleRestart(body.action==='restore'?'safe-restore':'safe-mode',task);
        sendJson(res,result.status,result.body);
      } catch(error) { sendJson(res,409,{ok:false,code:error.code||'rescue-failed'}); }
    });

    registerRoute('GET', '/bingo/recovery', async (req, res) => {
      ensureProfile();
      sendJson(res, 200, recoverableView());
    });

    registerRoute('POST', '/bingo/rollback', async (req, res) => {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, code: parsed.code });
      ensureProfile();
      if (isRestarting()) return sendJson(res, 409, { ok: false, code: 'restarting' });
      const guard = writeGuard();
      if (guard.busy) return sendJson(res, 409, { ok: false, code: guard.reason });
      const body = parsed.value;
      if (body.confirmed !== true) return sendJson(res, 400, { ok: false, code: 'confirmation-required' });
      if (typeof body.checkpoint !== 'string') return sendJson(res, 400, { ok: false, code: 'invalid-checkpoint' });
      const target = activity().checkpointById(body.checkpoint);
      if (!target) return sendJson(res, 409, { ok: false, code: 'checkpoint-missing' });
      const result = await runRecovery(() => applyRollback(target));
      sendJson(res, result.status, result.body);
    });

    registerRoute('POST', '/bingo/cleanup', async (req, res) => {
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return sendJson(res, parsed.status, { ok: false, code: parsed.code });
      ensureProfile();
      if (isRestarting()) return sendJson(res, 409, { ok: false, code: 'restarting' });
      const guard = writeGuard();
      if (guard.busy) return sendJson(res, 409, { ok: false, code: guard.reason });
      const body = parsed.value;
      if (body.confirmed !== true) return sendJson(res, 400, { ok: false, code: 'confirmation-required' });
      try {
        const result = await runRecovery(() => {
          const quarantine = supportTools().quarantine;
          return body.action === 'restore' || body.action === 'purge'
            ? quarantine.change(body.action, body.id)
            : quarantine.isolate(body.ids);
        });
        sendJson(res, 200, result);
      } catch(error) {
        sendJson(res,409,{ok:false,code:error.code||'cleanup-failed'});
      }
    });
  }

  return { activity, observeActivity, recordBoot, readLegacySafeMode, view: recoverableView, applyRollback, busy, registerRoutes };
}
