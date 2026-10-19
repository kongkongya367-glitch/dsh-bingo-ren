# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - 2026-10-19

Initial release, prepared but **not yet published**.

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

- npm package name: `dsh-bingo-restart` (`dsh-bingo` was already taken).
- Not yet published to npm; not yet listed in the community plugin directory.
- Repository URLs in `package.json` are explicit placeholders.
