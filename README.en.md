# Bingo

**After you install a plugin, Bingo helps with the next step.**

A local plugin companion for DeepSeek Harness: restart reminders, runtime checks, trial decisions and recovery.

[中文](README.md) · [Releases](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases)

<img src="assets/readme-hero.png?v=060" width="100%" alt="Bingo plugin companion">

## Four places, clear next actions

| Destination | Purpose |
| --- | --- |
| Overview | New plugins awaiting restart, trials awaiting a decision and host-reported failures, with direct actions |
| Plugins | Search by name; filter failures, trials, recent changes or disabled entries; inspect status and decide trial outcomes in the same row |
| Changes | Additions, declared version changes, enable/disable changes, removals and trial decisions |
| Recovery & tools | Rollback, minimal boot and independent rescue; select quarantine or startup trends when needed |

<img src="assets/screenshot-overview.png?v=060" width="100%" alt="Overview with next actions">

The plugin list covers up to 1000 declared packages, with failures first. Recent changes are a filter rather than the only runtime-check targets. Trials ask on the next boot: keep, defer or explicitly remove. They do not isolate permissions or auto-uninstall.

“Active” means a host entry has started. Actual business behaviour and loaded code version still require verification; unavailable host information stays unknown.

## Useful information when asking for help

Generate a diagnostic summary from Overview, review it, then copy. It includes package names, declared versions, reported states and recent changes. Local/custom source addresses are omitted. It does not read chats or configuration, nor include profile paths, log paths or raw errors. The list of installed plugins can still reveal usage habits; review before sharing. A selectable-text fallback works when clipboard access is unavailable. Nothing is sent automatically.

## Install

In Harness, **Settings → Plugins → Add plugin**:

```text
dsh-bingo-ren
```

Or use `https://github.com/kongkongya367-glitch/dsh-bingo-ren`.

**Quit and reopen Harness once after installation or an update.** A release-age policy may postpone automatic updates; pin `dsh-bingo-ren@0.6.0` if the host permits it. Check the version actually installed.

Requires Node.js 20+ and Harness 0.2.0-rc.1+. Whole-app restart needs the official Electron desktop app and interrupts running tasks: save your work first. Web mode offers page refresh.

The draggable button snaps to edges, remembers position and supports light/dark themes. `Ctrl+Alt+B` opens the panel (`Cmd+Alt+B` on macOS). New-plugin reminders remember a deferred group and notify again for a newer group.

## Recovery boundaries

- **Rollback:** last eight pre-change inventory checkpoints, delegated to the native manager. Plugin data remains. Version 0.6.0 fixes dropped enablement in newly recorded checkpoints and keeps disabled packages disabled through reinstall. Older unknown enablement is not invented: currently installed packages keep their current choice.
- **Minimal boot:** back up package.json and profile YAML byte-for-byte, wait for the old processes and port to exit, then select only dsh-base, dsh-web-app and Bingo while temporarily neutralizing profile patches. Installed dependencies and data remain. Restore refuses unrelated configuration edits. Only the standard desktop profile layout is supported; global/CLI overlays and host faults are outside its scope.
- **Independent rescue:** a Windows launcher is saved after a healthy load under the local Bingo state's `救援` directory. Close Harness completely before using it. It survives later package damage. Alternatively extract a release and run `node lib/rescue-cli.mjs enter --profile <absolute-profile> --closed --apply`; use `restore` to recover. `--without-bingo` excludes Bingo too; `status` is read-only. Backups may contain original configuration credentials and should remain private.
- **Quarantine:** only reviewed candidates at least ten minutes old, dead-PID temporary package directories, pnpm ignored copies and exact-name data for recorded removals absent from other readable standard profiles. No dependency-tree pruning or link traversal. Same-volume moves can be restored unless the source is occupied. A second confirmation permanently deletes; quarantine alone does not free disk space. Candidate does not mean proven garbage.
- **Startup trends:** up to sixty local observations from host-process start to first Bingo UI connection. This is not total Electron startup. Minimal, hot-attached and late observations are separate from ordinary averages. Unknowns remain unknown. Changes alongside timing do not establish causality; no history is fabricated.

Advanced recovery UI loads on demand. The new client requests leftover scanning only when quarantine is selected. Missing advanced UI does not prevent ordinary plugin viewing or restart controls.

Records are per profile under local Bingo state: last 200 history entries, 100 displayed; recording starts with a quiet baseline. Unchanged version ranges with changed lockfile resolutions are not yet detected. No telemetry, no runtime dependencies, MIT licensed. Confirmed native package operations may contact the configured registry. Filesystem writes share the host's native PID-lock protocol.

Screenshots are real browser captures using mock data. [Development and configuration](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md) · [Issues](https://github.com/kongkongya367-glitch/dsh-bingo-ren/issues) · [MIT License](LICENSE)
