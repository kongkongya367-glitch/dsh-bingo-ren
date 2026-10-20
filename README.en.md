# Bingo

**Install a plugin — Bingo takes over from there.**

> "Just restart already."
>
> From remembering that restart, to logging plugin changes, asking whether a trial stays, showing post-boot health, and rolling back when an install goes wrong.

[Install](#install) · [Releases](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases) · [中文](README.md)

<p align="center"><img src="assets/readme-hero.png?v=050-preview" width="100%" alt="Bingo: install a plugin, Bingo takes over — prompt, history, trials, acceptance, rollback."></p>

Bingo is the **clean-up crew for DeepSeek Harness plugins**. It lives in one draggable button and picks up the loose ends that appear after you install something.

You install; it records. You hit “later”; it remembers that exact group. Mark a plugin as a trial and it asks again on the next boot: **keep, or remove?** After a restart you can check reported health — and if an install broke something, roll back to the previous list.

## The idea is what happens *after* installing

| What happens to you | Where Bingo picks up |
| --- | --- |
| You installed a plugin and forgot to restart | Watches the local plugin list and prompts on new entries |
| Something broke and you can't recall what changed | Records additions, version changes, enable/disable and removals |
| You installed something to try, then forgot about it | Marks it as a trial and asks on the next boot |
| You restarted and want to confirm health | Reads host-reported state into an acceptance list |
| The app won't even open after an install | An independent recovery tool stages a minimal boot, then restores the backup |
| Uninstalled plugins leave files behind | Quarantine selected candidates, then restore or explicitly delete them |
| Startup seems slower lately | Compare consistent timing measurements alongside plugin changes |
| A new version is bad and you want the old one | Rolls the plugin list back to a checkpoint saved before the change |

## Install

In Harness: **Settings → Plugins → Add plugin**, then enter:

```text
dsh-bingo-ren
```

The GitHub URL works too:

```text
https://github.com/kongkongya367-glitch/dsh-bingo-ren
```

**Quit and reopen Harness once after installing or updating** so the new UI loads. Then click **Bingo → plugin manager**.

<details>
<summary>Stuck on an old version, or seeing a “release age” notice?</summary>

The host's pnpm policy may postpone brand-new releases. Pin an exact version in the app (for example `dsh-bingo-ren@0.5.0`), or install from the GitHub URL above. The installed version reported by the app is authoritative.

A running desktop profile should be managed from the in-app plugin page. For CLI development installs, use a separate test profile — see the [development notes](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md).

</details>

## 01 · Someone remembers the restart

Bingo watches the profile's plugin list and prompts when something new appears.

- **Bingo now** — you confirm, and the whole desktop app restarts.
- **Later** — remembers this exact group; the same group won't nag again, a newer one still will.
- **Mark these as a trial** — leaves a decision for the next boot.

<p align="center"><img src="assets/screenshot-new-plugin.png?v=050-preview" width="540" alt="New plugin prompt with restart now, later, and mark-as-trial"></p>

Whether a restart is strictly required depends on how the plugin is loaded. **A restart interrupts running tasks — save your work first.**

## 02 · A history you can actually read

Opens the record of additions, declared version changes, enable/disable toggles, removals and trial decisions. Records are per profile, stored locally, and survive restarts; anything that happened while the app was closed is tagged “found at startup”.

<img src="assets/screenshot-history.png?v=050-preview" width="100%" alt="Plugin change history with additions, version changes and removals">

Recording starts when Bingo is enabled — the first run only establishes a baseline. 200 entries are kept, 100 are shown.

## 03 · Try first, decide later

Mark an installed plugin, or the whole group from the new-plugin prompt. **On the next boot Bingo asks:**

**Keep · Ask again next boot · Remove**

<img src="assets/screenshot-trials.png?v=050-preview" width="100%" alt="Trial list awaiting a decision, with keep, defer and remove">

Keep ends the reminder. Remove needs a second confirmation and is delegated to the native plugin manager. If the declared version changed, the trial must be re-marked first.

Trials are a reminder mechanism: they do not isolate permissions and never auto-uninstall. Protected or in-use plugins remain subject to host restrictions.

## 04 · A look after boot

**Active · Load failed · Disabled · Pending · Unknown** — up to 30 recently changed plugins, or the current set when nothing changed.

<img src="assets/screenshot-checks.png?v=050-preview" width="100%" alt="Dark-mode acceptance list showing active, failed and unknown">

Active means the host entry is running. Business behaviour and the actually loaded code still need separate verification; missing evidence stays **unknown**.

## 05 · Recovery: roll back when an install goes wrong

Recovery, recoverable cleanup and startup health each have their own tab.

### Rollback

Every inventory change saves a checkpoint (last 8). Pick one and confirm — Bingo then removes packages the checkpoint did not have, reinstalls missing or version-changed ones, and restores the enabled state.

**Only the plugin list and enablement move. Plugin data under `~/.dsh/<plugin>/` is kept.** A restart is required.

Rollback goes through the native manager (`removeBundle` / `installBundle` / `setBundleEnabled`); the rollback operation does not edit `package.json` directly.

### Minimal boot and independent recovery

The recovery page can stage a minimal configuration and restart. Original package.json and profile YAML patches are backed up byte-for-byte. The detached helper waits for the old shell/host and port to exit before applying it. Only dsh-base, dsh-web-app and Bingo remain selected; profile overrides are temporarily neutralized. Dependencies and plugin data stay installed. Restore refuses unfamiliar configuration edits rather than overwriting them. Global/command-line overlays are outside this mode.

On Windows, an independent recovery launcher is saved under the local Bingo state directory's `救援` folder after a healthy load. Close Harness completely before using it, even if the GUI no longer opens. The independent copy survives a broken package update. Alternatively, extract a release and run `node lib/rescue-cli.mjs enter --profile <absolute-profile> --closed --apply`, then use `restore` to recover. `--without-bingo` also excludes Bingo; `status` is read-only. Backups may contain configuration credentials and should remain private.

### Recoverable cleanup

Candidates must be at least ten minutes old: pnpm ignored copies, temporary directories whose PID has exited, and exact-name data directories for recorded removals absent from other readable standard profiles. No guessing stripped package prefixes, no hoisted-dependency pruning, and no following links or junction ancestors. Running package paths and Bingo's code are protected.

Selected candidates move to same-volume quarantine. Restore refuses an occupied original path. Permanent deletion requires another explicit confirmation; quarantine alone does not free disk space. Profile operations share the host's writer-lock protocol and check surviving package runs. Candidates still require human review.

### Startup health

Every observed host boot records the time from host-process start to the first Bingo UI connection, package counts, reported active/failed host entries and problematic bundles. Keep up to sixty records per profile and compare package changes between boots. Missing inventory remains unknown. Minimal boots, hot attachments and observations later than two minutes are kept separate from normal averages. This is not total Electron startup time, and correlated changes do not establish which plugin caused a slowdown. No history is fabricated before the observer was installed.

### Restart history

Every restart reports **total**, **stop** and **relaunch** durations, the average and the slowest so far, plus which plugins changed around it — from the timestamps the helper writes to `~/.dsh/bingo/restart.log`, not estimates. Rotated logs mean older rows disappear; Bingo only shows what it can prove.

## Coordinating with the host

Minimal configuration changes and quarantine operations use the native package.json PID writer-lock protocol and check surviving package runs. An active or unrecognized lock blocks writes; a proven-dead owner can be reclaimed. The persistent `.pnpm/lock.yaml` is not an active-operation signal. Rollback remains delegated to the native manager.

## A small button that stays out of the way

Drag it near an edge to snap; its position survives restarts. Open the panel with `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS). Light and dark themes, web mode refresh, zero runtime dependencies, MIT licensed.

<details>
<summary>Panel, dark mode and drag examples</summary>

<p align="center"><img src="assets/screenshot-panel.png?v=050-preview" width="400" alt="Restart panel with plugin manager entry"></p>

<p align="center"><img src="assets/screenshot-panel-dark.png?v=050-preview" width="400" alt="Dark restart panel"></p>

<p align="center"><img src="assets/screenshot-dragged.png?v=050-preview" width="440" alt="Panel repositioned after dragging"></p>

</details>

## Local data and clear boundaries

History, trials, checkpoints and restart logs live on this machine under `~/.dsh/bingo/`, with no conversation content and no telemetry. Confirmed plugin operations are executed by the host manager, which may contact its configured registry.

All images are **real browser captures using mock data** — no real accounts, chats or installs. Recreate them with the [preview instructions](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/preview/README.md).

<details>
<summary>Configuration, compatibility and troubleshooting</summary>

Requires **Node.js 20+** and **DeepSeek Harness 0.2.0-rc.1+**. Full restart needs the official Electron desktop app; acceptance, native removal, rollback and restoration of legacy disabled bundles need the matching host APIs. Minimal boot requires the standard desktop profile layout. Missing capabilities are reported explicitly.

Configure in the profile's `cordis.patch.yml`:

```yaml
- id: dsh-bingo-ren
  config:
    enabled: true
    pollMs: 4000           # 1500-60000 ms
    allowRestart: true
    position: bottom-left # or bottom-right
    debug: false
```

- No button: restart once manually and confirm the plugin is enabled.
- Restart failed: read `~/.dsh/bingo/restart.log`.
- Acceptance says unknown: the host may not report runtime state; check the native plugin page.
- All recovery buttons greyed out: the plugin manager is installing or updating; retry afterwards.
- Uninstall: remove Bingo from the Harness plugin page, then restart. Source-install recovery steps are in the [development notes](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md).

</details>

[Report an issue](https://github.com/kongkongya367-glitch/dsh-bingo-ren/issues) · [Development notes](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md) · [MIT License](LICENSE)
