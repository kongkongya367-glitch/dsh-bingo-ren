'use strict';
/**
 * Test fixture: a replacement-process stand-in (cfg.testLaunch target).
 *
 * Writes a JSON marker to argv[2] with the facts the tests assert (pid, when
 * it started, whether ELECTRON_RUN_AS_NODE was cleaned, DSH_HOME/DSH_PROFILE
 * survived) and then stays alive so the helper records "replacement alive".
 * The test kills it during cleanup; it is never a real Electron app.
 */
const fs = require('node:fs');

const markerPath = process.argv[2];
const marker = {
  pid: process.pid,
  at: new Date().toISOString(),
  ts: Date.now(),
  exe: process.execPath,
  cwd: process.cwd(),
  electronRunAsNode: Object.hasOwn(process.env, 'ELECTRON_RUN_AS_NODE') ? process.env.ELECTRON_RUN_AS_NODE : null,
  nodeOptions: Object.hasOwn(process.env, 'NODE_OPTIONS') ? process.env.NODE_OPTIONS : null,
  dshDesktopNodeExecutable: Object.hasOwn(process.env, 'DSH_DESKTOP_NODE_EXECUTABLE')
    ? process.env.DSH_DESKTOP_NODE_EXECUTABLE
    : null,
  dshShell: Object.hasOwn(process.env, 'DSH_SHELL') ? process.env.DSH_SHELL : null,
  dshSessionId: Object.hasOwn(process.env, 'DSH_SESSION_ID') ? process.env.DSH_SESSION_ID : null,
  dshWebUrl: Object.hasOwn(process.env, 'DSH_WEB_URL') ? process.env.DSH_WEB_URL : null,
  dshHome: Object.hasOwn(process.env, 'DSH_HOME') ? process.env.DSH_HOME : null,
  dshProfile: Object.hasOwn(process.env, 'DSH_PROFILE') ? process.env.DSH_PROFILE : null,
};

try {
  fs.writeFileSync(markerPath, JSON.stringify(marker));
} catch (error) {
  process.stderr.write('marker fixture failed: ' + String(error && error.message) + '\n');
  process.exit(2);
}

setInterval(() => {}, 1000);
