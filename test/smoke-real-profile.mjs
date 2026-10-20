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
const guard = {busy:profileWriterBusy(profileDir)||packageRunBusy(profileDir)};
note('write guard: ' + (guard.busy ? 'busy (native PID lock/run)' : 'idle'));

/* 2. Leftover scan must never offer hoisted dependencies or runtime dirs. */
const quarantine = createQuarantine({profileDir,dshHome,stateDir:path.join(dshHome,'bingo')});
const leftovers = quarantine.scan();
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
    const relative = path.relative(nodeModulesDir, item.path);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      fail('leftover outside node_modules: ' + item.path);
    }
  }
}

/* 3. Nothing offered may be a symlink or junction. */
for (const item of leftovers) {
  try {
    if (fs.lstatSync(item.path).isSymbolicLink()) fail('symlink offered for deletion: ' + item.path);
  } catch {
    fail('leftover disappeared during the scan: ' + item.path);
  }
}

/* 4. Every offered path must stay inside the profile or DSH home. */
const roots = [path.resolve(profileDir), path.resolve(dshHome)];
for (const item of leftovers) {
  const inside = roots.some(root => {
    const rel = path.relative(root, path.resolve(item.path));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!inside) fail('leftover outside the profile and DSH home: ' + item.path);
}

for (const noteText of notes) console.log('ok   ' + noteText);
if (problems.length) {
  for (const problem of problems) console.error('FAIL ' + problem);
  console.error(problems.length + ' problem(s) — scanners must be fixed before shipping');
  process.exit(1);
}
console.log('smoke ok — nothing unsafe would be offered');
