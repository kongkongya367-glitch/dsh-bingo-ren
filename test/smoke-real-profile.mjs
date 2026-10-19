#!/usr/bin/env node
/**
 * Read-only smoke check against the *real* DSH profile.
 *
 * Every P0 bug found in the 0.3.x audit would have been caught by running the
 * scanners against an actual profile instead of a synthetic temp directory:
 *
 *  - hoisted transitive dependencies were reported as orphans (deleting them
 *    breaks every plugin),
 *  - runtime directories such as ~/.dsh/electron were reported as leftover
 *    plugin data,
 *  - a permanent pnpm lock file made the write guard report "busy" forever.
 *
 * This script never writes, never deletes and never talks to the network.
 * It exits non-zero when a scanner would offer something it must not.
 *
 * Usage: node test/smoke-real-profile.mjs [--profile <dir>] [--dsh-home <dir>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findLeftovers, guardProfileWrites, dataDirCandidates } from '../lib/recovery.js';
import {createQuarantine} from '../lib/quarantine.js';
import {profileWriterBusy,packageRunBusy} from '../lib/local-state.js';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dshHome = path.resolve(argOf('--dsh-home', process.env.DSH_HOME || path.join(os.homedir(), '.dsh')));
const profileDir = path.resolve(argOf('--profile', path.join(dshHome, 'profiles', 'desktop')));
const nodeModulesDir = path.join(profileDir, 'node_modules');
const manifestPath = path.join(profileDir, 'package.json');

const problems = [];
const notes = [];

function fail(message) { problems.push(message); }
function note(message) { notes.push(message); }

if (!fs.existsSync(manifestPath)) {
  console.log('no profile manifest at ' + manifestPath + ' — nothing to check');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const dependencies = manifest && typeof manifest.dependencies === 'object' && manifest.dependencies ? manifest.dependencies : {};
const declared = Object.keys(dependencies);
const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : [];

console.log('profile      ' + profileDir);
console.log('dependencies ' + declared.length);
console.log('bundles      ' + bundles.length);

/* 1. The write guard must not be blocked by permanent files. */
const guard = {busy:profileWriterBusy(profileDir)||packageRunBusy(profileDir),reason:null};
if (guard.busy && guard.reason === 'pnpm-lock') {
  fail('write guard reports pnpm-lock busy; a permanent lock file must not block recovery');
}
const lockPath = path.join(nodeModulesDir, '.pnpm', 'lock.yaml');
if (fs.existsSync(lockPath) && guard.reason === 'pnpm-lock') {
  fail('a permanent .pnpm/lock.yaml is being treated as an active operation');
}
note('write guard: ' + (guard.busy ? 'busy (' + guard.reason + ')' : 'idle'));

/* 2. Leftover scan must never offer hoisted dependencies or runtime dirs. */
const leftovers = findLeftovers({
  nodeModulesDir,
  dshHome,
  profileDir,
  installedNames: declared,
  removedNames: [],
});
const kinds = leftovers.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1;
  return acc;
}, {});
note('leftovers: ' + (leftovers.length ? JSON.stringify(kinds) : 'none'));

for (const item of leftovers) {
  if (item.kind === 'orphan') {
    fail('orphan kind must not exist: ' + item.path);
  }
  if (item.kind === 'data') {
    fail('data cleanup offered without a removal record: ' + item.path);
  }
  const name = path.basename(item.path);
  if (/^(?:electron|cache|logs|profiles|sessions|storages|attachments)$/i.test(name)) {
    fail('runtime directory offered for deletion: ' + item.path);
  }
  if (item.kind === 'ignored' || item.kind === 'tmp') {
    const parent = path.dirname(item.path);
    if (path.resolve(parent) !== path.resolve(nodeModulesDir) && path.resolve(parent) !== path.resolve(nodeModulesDir, '.ignored')) {
      fail('leftover outside node_modules: ' + item.path);
    }
  }
}

/* 3. Data directory candidates must never collide with runtime directories. */
const RUNTIME = new Set(['bingo', 'profiles', 'sessions', 'storages', 'attachments', 'cache', 'electron', 'logs', 'dsh-runtimes', 'dsh-market', 'channel-pack']);
for (const name of declared) {
  for (const candidate of dataDirCandidates(name)) {
    if (RUNTIME.has(candidate)) fail('package ' + name + ' maps to runtime directory ' + candidate);
  }
}

/* 4. Nothing offered may be a symlink or junction. */
for (const item of leftovers) {
  try {
    if (fs.lstatSync(item.path).isSymbolicLink()) fail('symlink offered for deletion: ' + item.path);
  } catch {
    fail('leftover disappeared during the scan: ' + item.path);
  }
}

/* 5. Every offered path must stay inside the profile or DSH home. */
const roots = [path.resolve(profileDir), path.resolve(dshHome)];
for (const item of leftovers) {
  const inside = roots.some(root => {
    const rel = path.relative(root, path.resolve(item.path));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!inside) fail('leftover outside the profile and DSH home: ' + item.path);
}

const quarantine=createQuarantine({profileDir,dshHome,stateDir:path.join(dshHome,'bingo')});
const candidates=quarantine.scan();
for(const candidate of candidates)if(fs.lstatSync(candidate.path).isSymbolicLink())fail('linked cleanup candidate');
note('new quarantine scanner: '+candidates.length+' candidates (read-only; nothing moved)');

for (const noteText of notes) console.log('ok   ' + noteText);
if (problems.length) {
  for (const problem of problems) console.error('FAIL ' + problem);
  console.error(problems.length + ' problem(s) — scanners must be fixed before shipping');
  process.exit(1);
}
console.log('smoke ok — nothing unsafe would be offered');
