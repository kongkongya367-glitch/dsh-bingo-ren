/** Local, profile-scoped plugin history, trials, and runtime acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const LIMIT = 200;
const validName = value => typeof value === 'string' && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value);
const cleanPackages = value => Array.isArray(value) ? value.filter(p => p && validName(p.name))
  .slice(0, 1000).map(p => ({ name: p.name, version: typeof p.version === 'string' ? p.version.slice(0, 512) : null,
    ...(typeof p.enabled === 'boolean' ? { enabled: p.enabled } : {}) })) : [];

const CHECKPOINT_LIMIT = 8;
const sanitizeCheckpoints = value => Array.isArray(value) ? value
  .filter(c => c && typeof c.id === 'string' && Array.isArray(c.packages))
  .slice(0, CHECKPOINT_LIMIT)
  .map(c => ({
    id: c.id,
    at: typeof c.at === 'string' ? c.at : null,
    reason: typeof c.reason === 'string' ? c.reason.slice(0, 64) : 'change',
    packages: cleanPackages(c.packages),
  })) : [];

export function diffInventory(before, after) {
  const old = new Map(cleanPackages(before).map(p => [p.name, p.version]));
  const next = new Map(cleanPackages(after).map(p => [p.name, p.version]));
  const changes = [];
  for (const [name, version] of next) {
    if (!old.has(name)) changes.push({ kind: 'added', name, from: null, to: version });
    else if (old.get(name) !== version) changes.push({ kind: 'updated', name, from: old.get(name), to: version });
  }
  for (const [name, version] of old) if (!next.has(name)) changes.push({ kind: 'removed', name, from: version, to: null });
  const previous = new Map(cleanPackages(before).map(p => [p.name, p]));
  for (const entry of cleanPackages(after)) {
    const prior = previous.get(entry.name);
    if (typeof prior?.enabled === 'boolean' && typeof entry.enabled === 'boolean' && prior.enabled !== entry.enabled)
      changes.push({ kind: entry.enabled ? 'enabled' : 'disabled', name: entry.name, from: prior.version, to: entry.version });
  }
  return changes.sort((a, b) => a.name.localeCompare(b.name));
}

export function createActivityJournal({ stateDir, profileDir, boot, now = () => Date.now() }) {
  let identity;
  try { identity = fs.realpathSync.native(profileDir); } catch { identity = path.resolve(profileDir); }
  if (process.platform === 'win32') identity = identity.toLowerCase();
  const key = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const file = path.join(stateDir, 'activity-' + key + '.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};
  let data = {
    observed: Array.isArray(raw.observed) ? cleanPackages(raw.observed) : null,
    history: Array.isArray(raw.history) ? raw.history.filter(e => e && typeof e.id === 'string' && typeof e.kind === 'string').slice(0, LIMIT) : [],
    trials: Array.isArray(raw.trials) ? raw.trials.filter(t => t && validName(t.name) && typeof t.id === 'string' && typeof t.boot === 'string').slice(0, 100) : [],
    targets: Array.isArray(raw.targets) ? cleanPackages(raw.targets).slice(0, 30) : [],
    checkpoints: Array.isArray(raw.checkpoints) ? sanitizeCheckpoints(raw.checkpoints) : [],
  };
  const at = () => new Date(now()).toISOString();
  function commit(next) {
    fs.mkdirSync(stateDir, { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, file);
    } finally {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    }
    data = next;
  }
  function add(next, entry) {
    next.history.unshift({ id: randomUUID(), at: at(), ...entry });
    next.history.length = Math.min(next.history.length, LIMIT);
  }
  const clone = () => JSON.parse(JSON.stringify(data));
  function observe(packages, source = 'running') {
    const current = cleanPackages(packages);
    const changes = data.observed === null ? [] : diffInventory(data.observed, current);
    if (data.observed !== null && !changes.length && JSON.stringify(data.observed) === JSON.stringify(current)) return;
    const next = clone();
    // Remember the pre-change package list so a rollback has a real target.
    if (data.observed !== null && changes.length) addCheckpoint(next, data.observed, 'change');
    for (const change of changes) {
      add(next, { ...change, source });
      next.targets = next.targets.filter(p => p.name !== change.name);
      if (change.kind !== 'removed') next.targets.unshift({ name: change.name, version: change.to });
      else next.trials = next.trials.filter(t => t.name !== change.name);
    }
    next.targets = next.targets.slice(0, 30);
    next.observed = current;
    commit(next);
  }
  function addCheckpoint(next, packages, reason) {
    const list = cleanPackages(packages);
    if (!list.length) return;
    const last = next.checkpoints[0];
    const same = last && last.packages.length === list.length && last.packages.every((p, i) => p.name === list[i].name && p.version === list[i].version && p.enabled === list[i].enabled);
    if (same) return;
    next.checkpoints.unshift({ id: randomUUID(), at: at(), reason, packages: list });
    next.checkpoints.length = Math.min(next.checkpoints.length, CHECKPOINT_LIMIT);
  }
  /** Record a checkpoint before Bingo itself mutates the profile. */
  function checkpoint(reason, packages) {
    const current = cleanPackages(packages || data.observed || []);
    if (!current.length) return null;
    const next = clone();
    addCheckpoint(next, current, typeof reason === 'string' ? reason : 'manual');
    commit(next);
    return next.checkpoints[0] || null;
  }
  function trial(action, { name, id, version } = {}) {
    const current = data.observed?.find(p => p.name === name);
    const existing = data.trials.find(t => t.name === name);
    if (action === 'start') {
      if (!current || name === 'dsh-bingo-ren') return { ok: false, code: 'not-trialable' };
      if (version !== undefined && current.version !== version) return { ok: false, code: 'version-changed' };
      if (existing && existing.version === current.version) return { ok: true };
      if (!existing && data.trials.length >= 100) return { ok: false, code: 'trial-limit' };
    } else if (!existing || existing.id !== id) return { ok: false, code: 'trial-changed' };
    const next = clone();
    if (action === 'start') {
      next.trials = next.trials.filter(t => t.name !== name);
      next.trials.push({ name, id: randomUUID(), version: current.version, createdAt: at(), boot, postponedBoot: null });
      add(next, { kind: 'trial-started', name });
    } else if (action === 'snooze') {
      next.trials.find(t => t.id === id).postponedBoot = boot;
    } else if (action === 'keep' || action === 'removed') {
      next.trials = next.trials.filter(t => t.id !== id);
      add(next, { kind: action === 'keep' ? 'trial-kept' : 'trial-removed', name });
    } else return { ok: false, code: 'invalid-action' };
    commit(next);
    return { ok: true };
  }
  function view() {
    const observed = data.observed || [];
    const trials = data.trials.map(t => ({ ...t,
      reviewDue: t.boot !== boot && t.postponedBoot !== boot,
      versionChanged: observed.find(p => p.name === t.name)?.version !== t.version,
    }));
    return {
      history: data.history.slice(0, 100), trials,
      packages: observed.filter(p => p.name !== 'dsh-bingo-ren'),
      targets: data.targets.length ? data.targets : observed.filter(p => p.name !== 'dsh-bingo-ren').slice(0, 30),
      checkpoints: data.checkpoints.map(c => ({ id: c.id, at: c.at, reason: c.reason, count: c.packages.length })),
      observedCount: observed.length,
    };
  }
  function summary() {
    const due = view().trials.filter(t => t.reviewDue);
    return { historyCount: data.history.length, trialCount: data.trials.length, reviewCount: due.length, checkpointCount: data.checkpoints.length,
      reviewSignature: due.length ? createHash('sha256').update(due.map(t => t.id).sort().join(',')).digest('hex') : '' };
  }
  /**
   * Plugin changes recorded near a restart, so the timeline can say which
   * plugins were waiting on it. Window looks back before the restart.
   * @param {string|null} iso restart timestamp
   * @param {number} windowMs how far back to look
   * @returns {Array<{kind: string, name: string, from: string|null, to: string|null, at: string}>}
   */
  function changesAround(iso, windowMs = 10 * 60 * 1000) {
    const at = Date.parse(iso || '');
    if (!Number.isFinite(at)) return [];
    return data.history
      .filter(e => {
        if (!['added', 'updated', 'removed'].includes(e.kind)) return false;
        const when = Date.parse(e.at || '');
        return Number.isFinite(when) && when <= at + 1000 && at - when <= windowMs;
      })
      .slice(0, 12)
      .map(e => ({ kind: e.kind, name: e.name, from: e.from ?? null, to: e.to ?? null, at: e.at }));
  }

  /**
   * Package names the journal recorded as removed and that are still absent
   * from the observed list. Cleanup only offers data directories for these:
   * guessing from directory names would delete live plugin data.
   * @returns {string[]}
   */
  function removedNames() {
    const gone = new Map();
    for (const entry of data.history) {
      if (entry.kind !== 'removed') continue;
      if (typeof entry.name !== 'string') continue;
      if (!gone.has(entry.name)) gone.set(entry.name, entry.at);
    }
    const live = new Set((data.observed || []).map(p => p.name));
    return [...gone.keys()].filter(name => !live.has(name)).slice(0, 200);
  }

  /** Full checkpoint contents, only reachable by id (kept out of the view). */
  function checkpointById(id) {
    const found = data.checkpoints.find(c => c.id === id);
    return found ? { id: found.id, at: found.at, reason: found.reason, packages: found.packages.map(p => ({ ...p })) } : null;
  }
  return { file, observe, trial, checkpoint, checkpointById, changesAround, removedNames, view, summary };
}

/** Do not infer activation from package files. Only the host's live entries count. */
export function buildAcceptance(targets, inventory, limit = 30) {
  const bundles = Array.isArray(inventory?.bundles) ? inventory.bundles : null;
  const plugins = Array.isArray(inventory?.plugins) ? inventory.plugins : null;
  return cleanPackages(targets).slice(0, Math.min(1000, Math.max(0, limit))).map(target => {
    const bundle = bundles?.find(b => b.name === target.name);
    let state = 'unknown';
    if (bundle?.error) state = 'failed';
    else if (bundle?.enabled === false) state = 'disabled';
    else if (bundle && plugins) {
      const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
      const live = rows.map(r => plugins.find(p => r.entryId && p.entryId === r.entryId));
      if (live.some(p => p?.fiberPhase === 'failed')) state = 'failed';
      else if (rows.length && live.every(p => p && p.enabled === false)) state = 'disabled';
      else if (rows.length && live.every(p => p && (p.enabled === false || p.fiberPhase === 'active')) && live.some(p => p?.enabled !== false)) state = 'active';
      else if (rows.length) state = 'pending';
    }
    return { ...target, installedVersion: typeof bundle?.version === 'string' ? bundle.version : null, state };
  });
}

export async function readHostInventory(manager, timeoutMs = 2500) {
  if (!manager || typeof manager.listBundles !== 'function') return null;
  let timer;
  try {
    return await Promise.race([
      Promise.all([manager.listBundles(), typeof manager.listPlugins === 'function' ? manager.listPlugins() : null])
        .then(([bundles, plugins]) => ({ bundles, plugins })),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
