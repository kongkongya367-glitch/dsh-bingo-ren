# Bingo — one-click restart for DeepSeek Harness

A draggable Bingo button that restarts the desktop app and prompts when new plugins are installed.

[中文说明](README.md) · [GitHub Releases](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases)

## Features

- Open the panel and click **Bingo 一下** to restart the entire desktop app.
- Detect new plugins while the app runs; **稍后** (Later) acknowledges the current set.
- Drag the button, snap it near an edge, and remember its position.
- Open with `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS).
- Light/dark themes, zero runtime dependencies, no telemetry.

## Preview

| Button | Panel | New plugin |
| --- | --- | --- |
| <img src="assets/screenshot-button.png" width="280" alt="Bingo button"> | <img src="assets/screenshot-panel.png" width="280" alt="Bingo panel"> | <img src="assets/screenshot-new-plugin.png" width="280" alt="New plugin dialog"> |

Images use mock data. The button, panel and dialog images are design renders; the [drag example](assets/screenshot-dragged.png) is a browser capture of the mock preview page.

## Install

In **Settings → Plugins → Add plugin**, enter:

```text
dsh-bingo-ren
```

You can also install using the [GitHub repository URL](https://github.com/kongkongya367-glitch/dsh-bingo-ren). Quit and reopen DeepSeek Harness once after installation so Bingo can load.

Manage the running desktop profile through the app. The CLI is for separate web or test profiles:

```sh
dsh plugin --profile bingo-selftest add dsh-bingo-ren
```

For a local source install, see the [development notes](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md).

## Use and limitations

Click **Bingo**, then **Bingo 一下**. The panel is the confirmation step.

**Restart interrupts running tasks.** Save your work first. If a restart fails, the panel recovers and allows another attempt. Diagnostics are in `~/.dsh/bingo/restart.log`.

The new-plugin dialog offers **立即 Bingo** (Restart now) and **稍后** (Later). Escape and clicking the backdrop also dismiss it. Plugins installed while the app is closed become the next startup baseline. A prompt indicates a new manifest entry; whether a restart is necessary depends on the plugin and host loading behavior.

Full restart requires the official Electron desktop app. Web mode disables restart and offers a page refresh. The interface currently uses Chinese labels.

## Plugin management

Open **插件记录 · 试用 · 验收** in the Bingo panel.

- **History:** records observed additions, declared-version changes, removals and trial decisions per profile. Keeps 200 entries locally and shows the newest 100. The first run establishes a baseline; unchanged manifest ranges with changed lockfile resolutions are not detected.
- **Trials:** mark an installed plugin, or mark newly added plugins from the prompt. On the next app boot, choose Keep, Ask next boot, or Remove. Removal needs explicit confirmation and uses the native host manager. Changed version declarations require re-marking first; Bingo cannot trial-remove itself. Trials do not isolate permissions or automatically uninstall packages.
- **Acceptance:** shows up to 30 recently changed plugins, or current plugins when no changes exist. Reads native bundle and live-entry state: active, failed, disabled, pending or unknown. Active means host entries are running; it does not independently verify business behavior or the loaded code version. Missing host information and client-only bundles are not treated as success.

History and trial state remain on this machine and do not include conversations. A confirmed removal delegates package operations to the host, which may use its configured registry. Protected or in-use plugins may require removal through the native plugin page.

## Configuration

Configure the plugin row in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-bingo-ren
  config:
    enabled: true
    pollMs: 4000           # 1500–60000 milliseconds
    allowRestart: true
    position: bottom-left # or bottom-right
    debug: false
```

`confirm` is reserved; the current client always opens the panel first.

## Uninstall

Remove Bingo in **Settings → Plugins**, then restart the app once. For a source install made with the local script, quit the app first and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -Uninstall
```

The local uninstaller removes only Bingo's dependency, bundle entry and package directory, preserving other plugin configuration. Optionally remove `~/.dsh/bingo/` to clear detection state and logs.

## Privacy and compatibility

Bingo reads the local profile manifest and uses same-origin `/bingo/*` routes. It sends no telemetry, loads no third-party assets, and stores state and logs locally.

Requires Node.js 20+ and DeepSeek Harness 0.2.0-rc.1+. Uses public Cordis APIs without modifying DSH core.

## Troubleshooting

- No button: restart once after installation and confirm the plugin is enabled.
- Restart disabled: use the desktop app and check `allowRestart`.
- Restart failed: inspect `~/.dsh/bingo/restart.log`, resolve executable or permission problems, and retry.

[MIT License](LICENSE)
