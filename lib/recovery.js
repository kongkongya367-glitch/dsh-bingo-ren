/**
 * Recovery primitives: rollback planning, safe mode, residual cleanup and the
 * write guard that keeps Bingo from racing the native plugin manager.
 *
 * Everything here is pure or read-only so it can be unit tested without a
 * Cordis host. Applying a plan is the caller's job.
 *
 * Safety rule for this module: it may only *suggest* deletions it can prove are
 * leftovers. A false positive here deletes a user's dependency tree, so every
 * scan errs towards reporting nothing.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Package name shape accepted everywhere (same rule as the activity journal). */
const PACKAGE_NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

/** Bundles owned by the Harness build itself; never disabled by safe mode. */
const OFFICIAL_SCOPE = '@deepseek-ai/';

/** Version prefixes that identify a non-registry spec instead of a range. */
const SPEC_PREFIX = /^(?:link|file|portal|workspace|git\+|git:|github:|https?|npm):/i;

const cleanList = value => Array.isArray(value)
  ? value.filter(p => p && PACKAGE_NAME.test(p.name))
    .slice(0, 1000)
    .map(p => ({
      name: p.name,
      version: typeof p.version === 'string' ? p.version.slice(0, 512) : null,
      enabled: p.enabled === false ? false : true,
    }))
  : [];

/**
 * Compare a checkpoint against the current package list.
 *
 * A package counts as changed when its declared version OR its enabled flag
 * differs, because disabling a bundle is the most common reason to roll back.
 *
 * @param {Array<{name: string, version: string|null, enabled?: boolean}>} current installed now
 * @param {Array<{name: string, version: string|null, enabled?: boolean}>} target checkpoint to return to
 * @returns {{remove: string[], install: Array<{name: string, version: string|null}>,
 *   enable: string[], disable: string[], same: number}}
 */
export function planRollback(current, target) {
  const now = new Map(cleanList(current).map(p => [p.name, p]));
  const want = new Map(cleanList(target).map(p => [p.name, p]));
  const remove = [];
  const install = [];
  const enable = [];
  const disable = [];
  let same = 0;
  for (const [name, entry] of now) {
    const wanted = want.get(name);
    if (!wanted) { remove.push(name); continue; }
    if (wanted.version !== entry.version) { install.push({ name, version: wanted.version }); continue; }
    if (wanted.enabled !== entry.enabled) { (wanted.enabled ? enable : disable).push(name); continue; }
    same += 1;
  }
  for (const [name, wanted] of want) if (!now.has(name)) install.push({ name, version: wanted.version });
  remove.sort();
  install.sort((a, b) => a.name.localeCompare(b.name));
  enable.sort();
  disable.sort();
  return { remove, install, enable, disable, same };
}

/** True when the plan changes nothing. */
export const isNoopPlan = plan => plan.remove.length === 0
  && plan.install.length === 0
  && plan.enable.length === 0
  && plan.disable.length === 0;

/**
 * Spec string for reinstalling one package at a checkpoint version.
 *
 * Registry ranges become `name@range`. Local links, file paths and git specs
 * are passed through unchanged: appending `@version` to them produces a spec
 * that pnpm cannot resolve.
 *
 * @param {{name: string, version: string|null}} entry
 * @returns {string}
 */
export function installSpec(entry) {
  const version = typeof entry.version === 'string' ? entry.version.trim() : '';
  if (!version) return entry.name;
  if (!SPEC_PREFIX.test(version)) return entry.name + '@' + version;
  // Local link and file specs must keep forward slashes: a Windows path with
  // backslashes inside `name@link:...` cannot be parsed by pnpm.
  const local = /^(?:link|file|portal):/i.test(version);
  const spec = local ? version.replace(/\\/g, '/') : version;
  return entry.name + '@' + spec;
}

/**
 * Pick the bundles a safe-mode session should turn off: everything the profile
 * composes except the Harness build's own packages and Bingo itself.
 *
 * @param {string[]} bundles currently selected bundle names
 * @param {string} selfName package name of Bingo
 * @returns {string[]}
 */
export function safeModeTargets(bundles, selfName = 'dsh-bingo-ren') {
  const seen = new Set();
  const out = [];
  for (const name of Array.isArray(bundles) ? bundles : []) {
    if (typeof name !== 'string') continue;
    if (name.startsWith(OFFICIAL_SCOPE)) continue;
    if (name === selfName) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.sort();
}

/**
 * Whether the native plugin manager has work in flight.
 *
 * Only the manager's own operation logs count. A `.pnpm/lock.yaml` is NOT a
 * signal: pnpm keeps that file permanently after the first install, so treating
 * it as "busy" would block every recovery action forever.
 *
 * @param {object} input
 * @param {string} [input.logsDir] profile/.plugin-manager/logs
 * @param {number} [input.now] current epoch ms
 * @param {number} [input.windowMs] how recently a log write counts as active
 * @returns {{busy: boolean, reason: string|null}}
 */
export function guardProfileWrites({ logsDir, now = Date.now(), windowMs = 120000 } = {}) {
  if (!logsDir) return { busy: false, reason: null };
  let entries = [];
  try { entries = fs.readdirSync(logsDir, { withFileTypes: true }); } catch { return { busy: false, reason: null }; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('operation-')) continue;
    const dir = path.join(logsDir, entry.name);
    let files = [];
    try { files = fs.readdirSync(dir); } catch { files = []; }
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      try {
        const stat = fs.statSync(path.join(dir, file));
        if (now - stat.mtimeMs <= windowMs) return { busy: true, reason: 'plugin-operation' };
      } catch { /* ignore */ }
    }
  }
  return { busy: false, reason: null };
}

/** Directories that are never deletion candidates. */
const PROTECTED_NAMES = new Set(['.bin', '.pnpm', '.modules.yaml', 'node_modules']);

/** Directories under DSH home that belong to the runtime, not to a plugin. */
const RUNTIME_DIRS = new Set([
  'bingo', 'profiles', 'sessions', 'storages', 'attachments', 'channel-pack',
  'dsh-runtimes', 'dsh-market', 'openai-gateway', 'cache', 'electron',
  'logs', 'node_modules', 'blob_storage', 'Local Storage',
]);

/**
 * Candidate directory names a removed package may have used under DSH home.
 * `~/.dsh/<dir>` is chosen by the plugin itself, so the only safe mapping is
 * the package name with and without its scope and `dsh-` prefix.
 *
 * @param {string} packageName e.g. `dsh-our-free-model` or `@scope/tool`
 * @returns {string[]}
 */
export function dataDirCandidates(packageName) {
  if (typeof packageName !== 'string' || !PACKAGE_NAME.test(packageName)) return [];
  const out = new Set();
  out.add(packageName);
  const unscoped = packageName.includes('/') ? packageName.split('/')[1] : packageName;
  out.add(unscoped);
  out.add(unscoped.replace(/^dsh-/, ''));
  out.add(unscoped.replace(/^dsh-plugin-/, ''));
  return [...out].filter(name => name && PACKAGE_NAME.test(name) && !name.startsWith('.'));
}

/**
 * Find leftovers the plugin manager provably leaves behind.
 *
 * Only two kinds are reported, both safe by construction:
 *  - `ignored`: pnpm moved a package aside into `node_modules/.ignored`
 *  - `tmp`:     `node_modules/<pkg>_tmp_<pid>_<n>` from an interrupted install
 *
 * Plus `data` entries, but only for packages Bingo itself recorded as removed
 * and only when the directory name is an exact candidate for that package.
 *
 * Hoisted transitive dependencies are deliberately NOT reported: with
 * `nodeLinker: hoisted` most `node_modules` entries are dependencies of
 * dependencies, and deleting them breaks every plugin that needs them.
 *
 * @param {object} input
 * @param {string} [input.nodeModulesDir]
 * @param {string} [input.dshHome]
 * @param {string} [input.profileDir]
 * @param {string[]} [input.installedNames] package names the profile still declares
 * @param {string[]} [input.removedNames] package names Bingo recorded as removed
 * @param {(dir: string) => number} [input.sizeOf] byte counter, injected for tests
 * @returns {Array<{kind: string, name: string, path: string, bytes: number}>}
 */
export function findLeftovers({
  nodeModulesDir,
  dshHome,
  profileDir,
  installedNames = [],
  removedNames = [],
  sizeOf,
} = {}) {
  const installed = new Set(installedNames.filter(n => typeof n === 'string'));
  const derivedProfile = profileDir || (nodeModulesDir ? path.dirname(nodeModulesDir) : null);
  const profileKey = derivedProfile ? normalizePath(derivedProfile) : null;
  const measure = typeof sizeOf === 'function' ? sizeOf : () => 0;
  const out = [];
  const push = (kind, name, target) => {
    let bytes = 0;
    try { bytes = measure(target) || 0; } catch { bytes = 0; }
    out.push({ kind, name, path: target, bytes });
  };

  if (nodeModulesDir) {
    const ignoredDir = path.join(nodeModulesDir, '.ignored');
    let ignored = [];
    try { ignored = fs.readdirSync(ignoredDir, { withFileTypes: true }); } catch { ignored = []; }
    for (const entry of ignored) {
      if (!entry.isDirectory()) continue;
      if (!PACKAGE_NAME.test(entry.name)) continue;
      push('ignored', entry.name, path.join(ignoredDir, entry.name));
    }
    let present = [];
    try { present = fs.readdirSync(nodeModulesDir, { withFileTypes: true }); } catch { present = []; }
    for (const entry of present) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (PROTECTED_NAMES.has(name) || name.startsWith('.')) continue;
      const tmp = /^(.+)_tmp_\d+_\d+$/.exec(name);
      if (!tmp) continue;
      if (!PACKAGE_NAME.test(tmp[1])) continue;
      push('tmp', tmp[1], path.join(nodeModulesDir, name));
    }
  }

  if (dshHome && removedNames.length) {
    let root = [];
    try { root = fs.readdirSync(dshHome, { withFileTypes: true }); } catch { root = []; }
    const present = new Map();
    for (const entry of root) {
      if (!entry.isDirectory()) continue;
      present.set(entry.name.toLowerCase(), entry.name);
    }
    const claimed = new Set();
    for (const name of removedNames) {
      if (typeof name !== 'string') continue;
      if (installed.has(name)) continue;
      for (const candidate of dataDirCandidates(name)) {
        if (RUNTIME_DIRS.has(candidate)) continue;
        const actual = present.get(candidate.toLowerCase());
        if (!actual || claimed.has(actual)) continue;
        claimed.add(actual);
        const target = path.join(dshHome, actual);
        if (profileKey && normalizePath(target) === profileKey) continue;
        push('data', name, target);
        break;
      }
    }
  }

  return out.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
}

/**
 * Keep a deletion request inside the directories Bingo is allowed to touch.
 * Refuses anything that is not one of the recorded leftover paths, and refuses
 * a path that is a symlink or junction so a link target is never deleted.
 *
 * @param {object} input
 * @param {Array<{path: string}>} input.candidates scanned leftovers
 * @param {string[]} input.requested absolute paths the user asked to delete
 * @returns {{allowed: string[], refused: Array<{path: string, reason: string}>}}
 */
export function selectDeletable({ candidates, requested }) {
  const known = new Map((candidates || []).map(c => [normalizePath(c.path), c]));
  const allowed = [];
  const refused = [];
  for (const raw of Array.isArray(requested) ? requested : []) {
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const key = normalizePath(raw);
    const candidate = known.get(key);
    if (!candidate) { refused.push({ path: raw, reason: 'not-a-known-leftover' }); continue; }
    let stat;
    try { stat = fs.lstatSync(key); } catch { refused.push({ path: raw, reason: 'missing' }); continue; }
    if (stat.isSymbolicLink()) { refused.push({ path: raw, reason: 'symbolic-link' }); continue; }
    if (!stat.isDirectory()) { refused.push({ path: raw, reason: 'not-a-directory' }); continue; }
    allowed.push(key);
  }
  return { allowed, refused };
}

/** Lowercase on Windows so case-only differences never bypass the whitelist. */
export function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Bundle names a profile composes, with their enabled state.
 * A bundle listed in `dsh.profile.bundles` is enabled; one that only appears in
 * `dependencies` is installed but not composed.
 *
 * @param {object} manifest parsed profile package.json
 * @returns {Array<{name: string, version: string|null, enabled: boolean}>}
 */
export function bundleStates(manifest) {
  const dependencies = manifest && typeof manifest === 'object' && manifest.dependencies && typeof manifest.dependencies === 'object'
    ? manifest.dependencies
    : {};
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles.filter(b => typeof b === 'string')
    : [];
  const composed = new Set(bundles);
  const out = new Map();
  for (const [name, version] of Object.entries(dependencies)) {
    if (!PACKAGE_NAME.test(name)) continue;
    out.set(name, { name, version: typeof version === 'string' ? version : null, enabled: composed.has(name) });
  }
  for (const name of composed) {
    if (!PACKAGE_NAME.test(name)) continue;
    if (out.has(name)) continue;
    out.set(name, { name, version: null, enabled: true });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
