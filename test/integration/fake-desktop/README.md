# fake-desktop end-to-end test

Tests the real restart chain without touching the installed app: a fake Electron
shell spawns a fake host whose argv[1] ends in `dsh-desktop-host/lib/index.js`,
the fake host mounts the real `lib/index.js` runtime with `createRuntime`, then
`POST /bingo/restart` runs the real `lib/restart-helper.cjs`. The helper kills
the two fake PIDs and launches a harmless process. No Electron process is used.
```
node test/integration/fake-desktop/run.mjs
```
