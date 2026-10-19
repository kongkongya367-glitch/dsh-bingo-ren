import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function fault(code) { return Object.assign(new Error(code), { code }); }
export function canonical(dir) { return fs.realpathSync.native(dir); }
export function profileKey(dir) {
  const value = canonical(dir);
  return createHash('sha256').update(process.platform === 'win32' ? value.toLowerCase() : value).digest('hex').slice(0, 24);
}
export function hash(value) { return createHash('sha256').update(value).digest('hex'); }
export function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); }
  finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
}
export function writeJSON(file, value) { atomic(file, JSON.stringify(value, null, 2) + '\n'); }
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
/** All descendants must stay under the named root, without junctions/links. */
export function confined(root, relative, { missing = false } = {}) {
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw fault('unsafe-path');
  let current = root;
  for (const piece of rel.split(path.sep)) {
    current = path.join(current, piece);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw fault('linked-path'); }
    catch (error) { if (missing && error.code === 'ENOENT') continue; throw error; }
  }
  return target;
}
export function packageRunBusy(profileDir) {
  const file = path.join(profileDir, '.plugin-manager', 'run.json');
  if (!fs.existsSync(file)) return false;
  const run = readJSON(file);
  if (!run || !Number.isSafeInteger(run.pid) || run.pid<=0) return true;
  if (alive(run.pid)) return true;
  if (run.grouped && process.platform!=='win32') {
    try { process.kill(-run.pid,0); return true; } catch(error) { return error.code!=='ESRCH'; }
  }
  return false;
}
export function profileWriterBusy(profileDir) {
  const file=path.join(profileDir,'package.json.lock');
  if(!fs.existsSync(file))return false;
  try { const record=fs.readFileSync(file,'utf8'); return !/^\d+\n$/.test(record) || Number(record)<=0 || alive(Number(record)); }
  catch {return true;}
}
/** Same wx/PID and stale-takeover protocol as Harness dsh-atomic-write. */
export function withProfileLock(profileDir, operation) {
  const lock = confined(profileDir, 'package.json.lock', { missing: true });
  const record = String(process.pid) + '\n';
  const exited = text => /^\d+\n$/.test(text) && Number(text) > 0 && Number(text) <= 2147483647 && !alive(Number(text));
  let acquired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fs.writeFileSync(lock, record, { flag: 'wx', mode: 0o600 }); acquired = true; break; }
    catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      let old; try { old = fs.readFileSync(lock, 'utf8'); } catch { throw fault('profile-busy'); }
      if (!exited(old)) throw fault('profile-busy');
      const claim = lock + '.takeover-' + hash(old).slice(0, 16);
      try { fs.writeFileSync(claim, record, { flag: 'wx', mode: 0o600 }); } catch { throw fault('profile-busy'); }
      try {
        if (fs.readFileSync(lock, 'utf8') !== old || !exited(old)) throw fault('profile-busy');
        fs.unlinkSync(lock);
      } finally { fs.rmSync(claim, { force: true }); }
    }
  }
  if (!acquired) throw fault('profile-busy');
  try {
    if (packageRunBusy(profileDir)) throw fault('plugin-operation');
    const value = operation();
    if (value && typeof value.then === 'function') throw fault('async-lock-operation');
    return value;
  } finally { if (fs.readFileSync(lock, 'utf8') === record) fs.unlinkSync(lock); }
}
