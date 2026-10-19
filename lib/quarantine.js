/** Conservative candidates and recoverable, same-volume directory moves. */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { alive, canonical, confined, fault, hash, profileKey, readJSON, writeJSON, withProfileLock } from './local-state.js';

const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const PROTECTED = new Set(['bingo','profiles','sessions','storages','attachments','cache','electron','logs','node_modules','dsh-runtimes','dsh-market','channel-pack','credentials','accounts','config','keys']);
const isoId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
export function createQuarantine({ profileDir, dshHome, stateDir, removedNames = () => [], now = () => Date.now(), minimumAgeMs = 600000 }) {
  profileDir = canonical(profileDir); dshHome = canonical(dshHome);
  const key = profileKey(profileDir);
  const file = path.join(stateDir, 'quarantine-' + key + '.json');
  const clock = () => new Date(now()).toISOString();
  const index = () => {
    const raw = readJSON(file, []);
    return Array.isArray(raw) ? raw.filter(r => r && isoId(r.id) && ['package','data'].includes(r.root) && typeof r.relative === 'string').slice(0, 200) : [];
  };
  const save = records => { const active=records.filter(r=>!['restored','purged','failed'].includes(r.status)); const inactive=records.filter(r=>['restored','purged','failed'].includes(r.status)); writeJSON(file,active.concat(inactive.slice(0,Math.max(0,200-active.length)))); };
  const rootFor = kind => kind === 'package' ? profileDir : dshHome;
  function destination(record, missing = true) {
    return confined(rootFor(record.root), path.join('.bingo-quarantine', key, record.id), { missing });
  }
  function source(record, missing = false) {
    if(record.relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw fault('unsafe-path');
    if (record.root === 'package' && !/^node_modules[\\/](?:\.ignored[\\/](?:@[\w.-]+[\\/])?[\w.-]+|(?:@[\w.-]+[\\/])?[\w.-]+_tmp_\d+_\d+)$/.test(record.relative)) throw fault('unsafe-path');
    if (record.root === 'data' && (!NAME.test(record.relative.replace(/\\/g,'/')) || PROTECTED.has(record.relative.toLowerCase()) || record.relative.startsWith('.'))) throw fault('unsafe-path');
    return confined(rootFor(record.root), record.relative, { missing });
  }
  function allInstalled() {
    const found = new Set();
    let entries;
    try { entries = fs.readdirSync(path.join(dshHome, 'profiles'), { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return null;
      if (!entry.isDirectory()) continue;
      const manifest = readJSON(path.join(dshHome, 'profiles', entry.name, 'package.json'));
      if (!manifest) return null;
      for (const name of [...Object.keys(manifest.dependencies || {}), ...(manifest.dsh?.profile?.bundles || [])]) found.add(name);
    }
    return found;
  }
  function referenced(target) {
    try { const code=fs.realpathSync.native(path.dirname(fileURLToPath(import.meta.url))); const rel=path.relative(target,code); if(!rel||(!rel.startsWith('..')&&!path.isAbsolute(rel)))return true; } catch {return true;}
    const profiles=new Set([profileDir]);
    try {
      for(const entry of fs.readdirSync(path.join(dshHome,'profiles'),{withFileTypes:true})) {
        if(entry.isSymbolicLink())return true;
        if(entry.isDirectory())profiles.add(path.join(dshHome,'profiles',entry.name));
      }
    } catch {}
    for(const profile of profiles) {
      const manifest=readJSON(path.join(profile,'package.json'));if(!manifest)return true;
      for(const name of Object.keys(manifest.dependencies||{})) {
        if(!NAME.test(name))continue;
        try { const live=fs.realpathSync.native(path.join(profile,'node_modules',name));const rel=path.relative(target,live);
          if(!rel||(!rel.startsWith('..')&&!path.isAbsolute(rel)))return true;
        } catch {}
      }
    }
    return false;
  }
  function scan() {
    const result = [];
    const sizeDeadline=Date.now()+180;let sizeVisits=0;
    function estimate(folder) {
      if(Date.now()>sizeDeadline||sizeVisits>1000)return {bytes:null,approximate:true};
      let bytes=0,approximate=false;const queue=[folder];
      while(queue.length) {
        if(Date.now()>sizeDeadline||sizeVisits>1000){approximate=true;break;}
        const current=queue.pop();let entries;
        try{entries=fs.readdirSync(current,{withFileTypes:true});}catch{approximate=true;continue;}
        for(const entry of entries) {
          if(++sizeVisits>1000||Date.now()>sizeDeadline){approximate=true;break;}
          if(entry.isSymbolicLink())continue;
          const child=path.join(current,entry.name);
          if(entry.isDirectory())queue.push(child);
          else if(entry.isFile())try{bytes+=fs.lstatSync(child).size;}catch{approximate=true;}
        }
      }
      return {bytes,approximate};
    }
    function offer(kind, relative, name) {
      try {
        const root = kind === 'data' ? 'data' : 'package';
        const record = { root, relative, name };
        const target = source(record);
        const stat = fs.lstatSync(target);
        if (!stat.isDirectory() || now() - stat.mtimeMs < minimumAgeMs || referenced(target)) return;
        const tmp = /_tmp_(\d+)_\d+$/.exec(relative);
        if (tmp && alive(Number(tmp[1]))) return;
        const fingerprint = [relative, stat.dev, stat.ino, stat.birthtimeMs, stat.mtimeMs].join('|');
        result.push({ ...record, kind, id: hash(fingerprint).slice(0, 32), path: target, ...estimate(target), modifiedAt: new Date(stat.mtimeMs).toISOString() });
      } catch { /* links, unreadable or changing paths are not candidates */ }
    }
    const read = relative => { try { return fs.readdirSync(confined(profileDir, relative), { withFileTypes: true }); } catch { return []; } };
    function packagesAt(relative, ignored) {
      for (const entry of read(relative)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        if(entry.name.startsWith('.'))continue;
        if (entry.name.startsWith('@') && /^@[\w.-]+$/.test(entry.name) && ['node_modules','node_modules/.ignored',path.join('node_modules','.ignored')].includes(relative)) { packagesAt(path.join(relative, entry.name), ignored); continue; }
        const tmp = /^([\w.-]+)_tmp_\d+_\d+$/.exec(entry.name);
        if (ignored && /^[\w.-]+$/.test(entry.name)) offer('ignored',path.join(relative,entry.name),entry.name);
        else if (!ignored && tmp) offer('tmp',path.join(relative,entry.name),tmp[1]);
      }
    }
    packagesAt('node_modules/.ignored', true); packagesAt('node_modules', false);
    const installed = allInstalled();
    if (installed) for (const name of removedNames()) {
      // Data-directory ownership has no standard API. Only exact names with a
      // recorded removal are proposed, after checking every readable profile.
      if (!NAME.test(name) || installed.has(name) || PROTECTED.has(name.toLowerCase())) continue;
      offer('data', name, name);
    }
    return result.slice(0, 60);
  }
  function recoverRecords(records) {
    for (const record of records) {
      try {
        const dst = destination(record); const src = source(record, true);
        if (record.status === 'moving' && fs.existsSync(dst)) record.status = 'isolated';
        if (record.status === 'restoring' && fs.existsSync(dst)) record.status='isolated';
        if (record.status === 'restoring' && !fs.existsSync(dst) && fs.existsSync(src)) record.status = 'restored';
        if (record.status === 'purging' && !fs.existsSync(dst)) record.status = 'purged';
      } catch { record.problem = 'unsafe-path'; }
    }
    return records;
  }
  function list() {
    const records=recoverRecords(index());
    return records.filter(r => !['restored','purged','failed'].includes(r.status)).map(r => ({ id:r.id, name:r.name, kind:r.kind, at:r.at, status:r.status, originalPath:r.problem?null:source(r,true), problem:r.problem || null }));
  }
  function isolate(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 20) throw fault('invalid-selection');
    return withProfileLock(profileDir, () => {
      const known = new Map(scan().map(c => [c.id,c]));
      if (ids.some(id => !known.has(id))) throw fault('stale-cleanup-scan');
      const records = recoverRecords(index());
      if (records.filter(r => !['restored','purged','failed'].includes(r.status)).length + ids.length > 100) throw fault('quarantine-full');
      const moved = [];
      for (const id of new Set(ids)) {
        const candidate = known.get(id);
        const record = { ...candidate, id:randomUUID(), at:clock(), status:'moving' };
        const src = source(record); const dst = destination(record);
        fs.mkdirSync(path.dirname(dst), { recursive:true, mode:0o700 });
        records.unshift(record); save(records);
        try { fs.renameSync(src,dst); record.status='isolated'; moved.push(record.id); }
        catch (error) { record.status='failed'; record.problem=error.code; save(records); throw fault('quarantine-move-failed'); }
        save(records);
      }
      return { ok:true, isolated:moved };
    });
  }
  function change(action,id) {
    if (!['restore','purge'].includes(action) || !isoId(id)) throw fault('invalid-selection');
    return withProfileLock(profileDir, () => {
      const records=recoverRecords(index()); const record=records.find(r=>r.id===id);
      if (!record || (record.status!=='isolated' && !(action==='purge'&&record.status==='purging'))) throw fault('quarantine-item-unavailable');
      const dst=destination(record,false); const src=source(record,true);
      if (action==='restore') {
        if (fs.existsSync(src)) throw fault('restore-path-occupied');
        record.status='restoring'; save(records);
        fs.mkdirSync(path.dirname(src),{recursive:true}); fs.renameSync(dst,src); record.status='restored';
      } else {
        const installed=allInstalled();
        if (referenced(dst) || (record.root==='data' && (!installed || installed.has(record.name)))) throw fault('plugin-in-use');
        record.status='purging'; save(records);
        // Exact UUID directory, resolved under a fixed quarantine root; root
        // and ancestors were checked for links. Never recurse over user input.
        fs.rmSync(dst,{recursive:true,force:false}); record.status='purged';
      }
      save(records); return {ok:true,action,id};
    });
  }
  return { scan,list,isolate,change };
}
