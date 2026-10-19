'use strict';
/**
 * Test fixture: a long-lived fake shell/host process.
 * Writes its PID to argv[2] (when given) and stays alive until killed.
 */
const fs = require('node:fs');

const pidFile = process.argv[2];
if (pidFile) {
  try {
    fs.writeFileSync(pidFile, String(process.pid));
  } catch {
    /* ignore */
  }
}

setInterval(() => {}, 1000);
