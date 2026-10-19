# Bingo — one-click restart for DeepSeek Harness

A quiet **Bingo** button in the bottom-left corner of DeepSeek Harness (dsh). Open it, and one click on **Bingo 一下** restarts the whole desktop app. When a plugin is installed while the app is running, Bingo notices and offers the restart for you.

- **Whole-app restart** — kills the Electron shell and its host process, waits for the old instance to release the port, then starts the app again.
- **New-plugin detection** — watches the profile manifest while the app runs; a new dependency raises a centered “检测到新插件” (new plugin detected) dialog. “稍后” (later) acknowledges that exact signature, so the next plugin asks again.
- **Keyboard shortcut** — `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS) opens the panel.
- **Zero runtime dependencies** — plain Node ESM plus one browser script; no React, no bundler, no npm install tree.
- **Native look** — neutral paper/ink palette, 1px borders, soft shadows, light theme by default with automatic dark-mode support. Inline SVG icon, no emoji.
- **Web/headless safe** — when a page is served outside the desktop shell, the button still appears, but restart is disabled and the panel explains why (and offers a page refresh).

**[中文说明 →](README.zh.md)**

## Preview

| Button | Panel | New plugin detected |
| --- | --- | --- |
| <img src="assets/screenshot-button.png" width="280" alt="Bingo button in the bottom-left corner"> | <img src="assets/screenshot-panel.png" width="280" alt="Bingo panel anchored above the button"> | <img src="assets/screenshot-new-plugin.png" width="280" alt="New plugin dialog"> |

These are **offline design previews** rendered from the same geometry and mock data as `preview/index.html` — not browser screenshots of a live profile. The dark panel preview is <a href="assets/screenshot-panel-dark.png">here</a>; `preview/README.md` has a one-line Edge command to retake real screenshots on any machine without the sandbox's named-pipe restriction.

## Install

### Desktop app

1. Open **Settings → Plugins**.
2. Choose **Add plugin**.
3. Enter `dsh-bingo-restart` and confirm.
4. **Restart DeepSeek Harness once by hand** (quit and reopen it).

This is the only supported way to install into the running desktop app: the app owns its `desktop` profile and rejects package operations against it from a separate CLI process. Do not use `dsh plugin --profile desktop …`; install through the app instead.

Step 4 is required only for the first install: the button is served by the plugin itself, so it cannot restart an app that has not loaded it yet. After that first restart the Bingo button handles every restart.

### dsh CLI (web and self-test profiles)

Once the package is published, the CLI path is for profiles that are **not** the running desktop app, such as `dsh web` or a disposable self-test profile:

```sh
dsh plugin --profile bingo-selftest add dsh-bingo-restart
```

The command needs the `dsh` CLI on your `PATH`. To install a local checkout during development:

```sh
dsh plugin --profile bingo-selftest add link:/absolute/path/to/this/checkout
```

`scripts/install.ps1` wraps that development install into a **separate self-test profile** and refuses to touch `desktop`. If Windows blocks the unsigned script, run it with `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1`.

### Local install before publishing (advanced)

If the package is not on npm yet and you want to evaluate Bingo in the real desktop profile, use the local installer **after quitting DeepSeek Harness** (source checkout only; `scripts/` is not shipped in the npm tarball):

```powershell
# Preview only — prints every change and writes nothing
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -WhatIf

# Copy this checkout into the desktop profile and register it
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1

# Restore the backed-up profile manifest and remove the copied package
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -Uninstall
```

Options: `-DshHome <dir>` (defaults to `$env:DSH_HOME` or `~/.dsh`), `-ProfileName desktop` (advanced; other profile names are allowed), and `-Force` to override the running-process check.

The script:

- refuses to run while a DeepSeek Harness process is detected, unless `-Force` is given;
- backs up `<profile>/package.json` to `package.json.bingo-backup`, adds the dependency and the bundle entry, and copies this checkout to `<profile>/node_modules/dsh-bingo-restart`;
- never runs `npm publish`, never kills or restarts the app, and touches only the named profile. `-Uninstall` restores the backup, removes the copied package, and keeps the backup for a repeat restore.

This is an advanced local-evaluation path, not the release install. Once published, Settings → Plugins remains the supported path.

## Use

1. Click **Bingo** (or press `Ctrl+Alt+B`) to open the panel. It shows whether the app can restart, any pending plugin, and the last restart.
2. Click **Bingo 一下** (“Bingo it”) to restart immediately. The panel is the confirmation step — the app does not ask twice.
3. **稍后** (“Later”) dismisses the current new-plugin prompt. It is remembered by signature, so it will not reappear for the same set of plugins; a newer install asks again.

The in-app panel ships with Chinese labels in 0.1.0; this guide quotes them and adds translations.

When a new plugin is detected, a centered dialog lists the new package names and versions:

- **立即 Bingo** (“Bingo now”) → same whole-app restart.
- **稍后** (“Later”) / `Esc` / clicking the backdrop → acknowledge this signature and keep working.

If you installed the plugin while the app was running, the first notification may refer to that install; acknowledge it and restart once manually.

## Configuration

All options are optional and live under the `dsh-bingo` row in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-bingo
  config:
    enabled: true          # false = do not inject the button or routes
    pollMs: 4000           # profile poll interval, 1500–60000
    confirm: true          # accepted by the host; 0.1.0 always shows the panel first
    allowRestart: true     # false = hard disable, e.g. an operations escape hatch
    position: bottom-left  # or bottom-right
    debug: false
```

In 0.1.0 the panel is always the confirmation step; `confirm` is accepted by the host but does not skip the panel yet.

## Safety

A restart is a real restart: the Electron shell and its host process are terminated and the app starts again. **In-flight tasks are interrupted**; the panel says so before you click. The restart helper:

- terminates only the two PIDs it was given (the shell that loaded it and its host process) — never by process name and never a process tree;
- waits for the old instance to exit and its port to be released, with a timeout and a logged fallback;
- starts a detached helper that survives the shutdown and launches the app again;
- appends diagnostics to `~/.dsh/bingo/restart.log` and keeps detection state in `~/.dsh/bingo/state.json`.

In `dsh web` or headless mode nothing is killed: restart is disabled and the panel offers **Refresh page** instead.

## Privacy

Bingo makes **no outbound network requests**. It only talks to its own host routes under `/bingo/*` on the loopback web server that already serves the page, and it reads the local profile `package.json` to detect newly installed plugins. It sends no telemetry and loads no third-party assets.

## Compatibility

- DeepSeek Harness **0.2.0-rc.1 or newer** (`engines.dsh`), Node.js **20 or newer**.
- Full whole-app restart: the official Electron desktop app.
- Degraded mode: `dsh web` / headless hosts that serve a page — the button is visible, restart is disabled.
- Built with the public Cordis webServer and index-injection APIs; it does not modify DSH core or any installed package.

## Uninstall

1. Open **Settings → Plugins**, find **Bingo**, and remove it. For the desktop profile this is the only supported path.
2. For a non-desktop profile, the CLI works: `dsh plugin --profile <profile> remove dsh-bingo-restart`.
3. If you installed with the advanced local script, quit the app and run `scripts/install-local-desktop.ps1 -Uninstall`.
4. Restart the app once. The button and its routes disappear.

Optional cleanup: delete `~/.dsh/bingo/` (detection baseline, acknowledgements, restart log).

## Troubleshooting

- **No button after install** — restart the app once; the first load cannot inject itself retroactively. Confirm the plugin is enabled in Settings → Plugins.
- **Button is visible but restart is disabled** — you are in web/headless mode; use the panel's refresh action.
- **Restart did nothing** — read `~/.dsh/bingo/restart.log`; the helper logs each stage (start, kill, wait, relaunch).
- **A new plugin was not announced** — the baseline is refreshed on every app start, so plugins installed while the app was closed are considered active and are not announced.

## License

[MIT](LICENSE)

---

> **Release status (explicit placeholder):** Bingo is **not published yet**. The package is intended to publish as `dsh-bingo-restart` (`dsh-bingo` is already taken), but nothing has been published to npm and the project is **not listed** in the community plugin directory. The repository/homepage/bugs URLs in `package.json` use the `your-name` placeholder and must be replaced before release. See `PUBLISH.md` in the project repository.
