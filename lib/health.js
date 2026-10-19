import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, profileKey, readJSON, writeJSON } from './local-state.js';
import { diffInventory } from './activity.js';

export function createStartupHealth({ profileDir,stateDir,boot,version,now=()=>Date.now(),hostStartedAt=Date.now()-process.uptime()*1000,elapsed=null }) {
  profileDir=canonical(profileDir);
  const file=path.join(stateDir,'startup-health-'+profileKey(profileDir)+'.json');
  function read() { const d=readJSON(file,[]);return Array.isArray(d)?d.filter(r=>r&&typeof r.boot==='string').slice(0,60):[]; }
  function begin(packages,{minimal=false,lateObservation=false}={}) {
    const rows=read(); if(rows.some(r=>r.boot===boot))return;
    const previous=rows[0];
    rows.unshift({id:randomUUID(),boot,version,startedAt:new Date(hostStartedAt).toISOString(),seenAt:new Date(now()).toISOString(),readyAt:null,hostToUiMs:null,
      packageCount:packages.length,activeCount:null,failedCount:null,failedBundleCount:null,pendingCount:null,inventoryKnown:false,minimal,lateObservation,
      changes:previous?diffInventory(previous.packages||[],packages):[],packages});
    writeJSON(file,rows.slice(0,60));
  }
  function ready(inventory, { observedAt = now(), elapsedMs = elapsed ? elapsed() : null } = {}) {
    const rows=read(); const row=rows.find(r=>r.boot===boot);
    if(!row||row.readyAt)return;
    row.readyAt=new Date(observedAt).toISOString();row.hostToUiMs=Math.max(0,Math.round(elapsedMs ?? observedAt-Date.parse(row.startedAt)));
    if(Array.isArray(inventory?.plugins)) {
      row.inventoryKnown=true;
      row.activeCount=inventory.plugins.filter(p=>p.enabled!==false&&p.fiberPhase==='active').length;
      row.failedCount=inventory.plugins.filter(p=>p.enabled!==false&&p.fiberPhase==='failed').length;
      row.pendingCount=inventory.plugins.filter(p=>p.enabled!==false&&!['active','failed'].includes(p.fiberPhase)).length;
      if(Array.isArray(inventory.bundles)) {
        const failed=new Set(inventory.plugins.filter(p=>p.enabled!==false&&p.fiberPhase==='failed').map(p=>p.entryId));
        row.failedBundleCount=inventory.bundles.filter(b=>b.enabled===true&&(b.error||(b.rows||[]).some(r=>failed.has(r.entryId)))).length;
      }
    }
    writeJSON(file,rows);
  }
  function report() {
    const items=read().map(({packages,boot,...r})=>r);
    const measured=items.filter(r=>Number.isFinite(r.hostToUiMs)&&!r.minimal&&!r.lateObservation);
    return {ok:true,metric:'host-to-bingo-ui',items,stats:{count:measured.length,averageMs:measured.length?Math.round(measured.reduce((n,r)=>n+r.hostToUiMs,0)/measured.length):null},
      note:'耗时从宿主进程启动到 Bingo 界面首次连接就绪，不包含完整 Electron 启动；插件变化与耗时仅供对照，不代表因果关系。'};
  }
  return {begin,ready,report,file};
}
