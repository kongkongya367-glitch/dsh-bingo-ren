'use strict';
/**
 * Test fixture: a long-lived TCP listener on 127.0.0.1:0.
 * Writes the allocated port to argv[2] so the test can point the helper at it.
 */
const fs = require('node:fs');
const net = require('node:net');

const portFile = process.argv[2];
const server = net.createServer((socket) => socket.destroy());

server.listen(0, '127.0.0.1', () => {
  if (portFile) {
    try {
      fs.writeFileSync(portFile, String(server.address().port));
    } catch {
      /* ignore */
    }
  }
});

setInterval(() => {}, 1000);
