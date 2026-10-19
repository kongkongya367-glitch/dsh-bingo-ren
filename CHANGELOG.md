# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.2] - 2026-10-19

### Fixed

- Detect new plugins when a hot recomposition happens before the previous detector runs.
- Recover the panel and allow retry after a restart fails; ignore status requests started before the restart.
- Show restart errors from the new-plugin dialog in the panel and disable unsupported restart actions.
- Local uninstall removes only Bingo entries, preserving later profile changes and junction targets.

### Changed

- Remove personal machine paths and internal task notes from public documentation and preview data.
- Shorten installation, development and release instructions; add build and test commands.

## [0.1.1] - 2026-10-19

### Fixed

- **New-plugin prompts no longer disappear when dshmarket hot-mounts a plugin.**
  A Cordis recomposition re-applies Bingo in the same host process; v0.1.0
  refreshed its baseline there, adopting the just-installed plugin silently.
  The baseline and pending record now persist across same-process
  recompositions and are only refreshed on a real app boot (new runtime token).
- Detection now also reacts to `fs.watch` changes immediately, with the 4s
  `stat` poll kept as a fallback.
- Pending state and runtime token are persisted in `state.json`; a
  `events.log` records baseline/pending transitions for support.

### Added

- **Drag and snap** — drag the Bingo capsule anywhere; releasing near an edge
  snaps to the nearest edge, the panel re-anchors, and the position is
  remembered in localStorage across restarts.

## [0.1.0] - 2026-10-19

Initial implementation.

### Added

- Bottom-left **Bingo** capsule in DeepSeek Harness, with a panel anchored above it.
- Whole-app restart of the Electron desktop app via a detached restart helper:
  terminate the shell/host PIDs, wait for exit and port release, relaunch, log every stage.
- New-plugin detection: watches the profile manifest at runtime and offers a restart
  when the dependency/bundle signature changes; per-signature "later" acknowledgement.
- Centered **检测到新插件** (new plugin detected) dialog with package names and versions.
- `Ctrl+Alt+B` / `Cmd+Alt+B` shortcut.
- Degraded web/headless mode: visible button, disabled restart, page-refresh fallback.
- Optional host plugin config: `enabled`, `pollMs`, `confirm`, `allowRestart`,
  `position`, `debug`.
- English and Chinese READMEs, MIT license, market icon and release runbook.
- Advanced local desktop installer for pre-publication evaluation
  (`scripts/install-local-desktop.ps1`) with manifest backup, `-WhatIf` and restore.
- Zero runtime npm dependencies; no outbound network requests.

### Notes

- npm package name: `dsh-bingo-ren` (`dsh-bingo` was already taken).
- Not yet published to npm; not yet listed in the community plugin directory.
- Repository metadata points to the public GitHub repository.
