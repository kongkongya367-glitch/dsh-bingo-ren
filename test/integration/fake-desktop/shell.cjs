'use strict';
// Fake Electron shell: spawns a "desktop host" child whose argv[1] ends with
// dsh-desktop-host/lib/index.js (the plugin's desktop detector), then waits to
// be killed by the real restart helper.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const codeDir = __dirname;
const dir = process.env.BINGO_FAKE_DIR || __dirname;
const hostEntry = path.join(codeDir, 'dsh-desktop-host', 'lib', 'index.js');
fs.writeFileSync(path.join(dir, 'shell.pid'), String(process.pid));
const child = spawn(process.execPath, [hostEntry], {
  cwd: codeDir,
  stdio: 'ignore',
  windowsHide: true,
  env: { ...process.env, BINGO_FAKE_DIR: dir, BINGO_FAKE_SHELL_PID: String(process.pid) },
});
fs.writeFileSync(path.join(dir, 'host.pid'), String(child.pid));
child.unref();
setInterval(() => {}, 1000);