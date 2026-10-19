# Bingo

**Install a plugin. Let Bingo take the next shift.**

> It started with one sentence: “You should probably restart.”
>
> Now it also remembers what changed, asks which trials to keep, and shows what the host reports after startup.

[中文说明](README.md) · [Install](#install) · [Releases](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases)

<img src="assets/readme-hero.png?v=020-preview" width="100%" alt="Bingo: restart reminders, plugin history, trial decisions and startup status in one small button">

Bingo handles the small tasks that follow a plugin installation in **DeepSeek Harness**: remembering the restart, keeping a change trail, following up on a trial, and showing reported runtime state. The interface uses Chinese labels.

## The idea: follow through after installation

| The moment | What Bingo adds |
| --- | --- |
| You install a plugin and forget the restart | Detect additions in the local profile and offer a restart |
| Something changes and you need a timeline | Keep observed additions, declared-version changes and removals |
| You install something just to try it | Mark a trial and decide on the next app boot |
| The app is back and you want to check status | Show native host-reported activation state |

## Install

In **Settings → Plugins → Add plugin**, enter:

```text
dsh-bingo-ren
```

Or use the repository URL:

```text
https://github.com/kongkongya367-glitch/dsh-bingo-ren
```

Quit and reopen Harness once after installing or updating. Open **Bingo → 插件记录 · 试用 · 验收** for plugin management.

The host's minimum-release-age policy may hold back a fresh release. Follow the app's prompt to request `dsh-bingo-ren@0.2.0`, or install from GitHub. Manage a running desktop profile through the app; use a separate test profile for CLI development.

## 01 · Remember the restart

Bingo observes the profile manifest while the app runs. When it finds new packages, choose **立即 Bingo** (Restart now), **稍后** (Later), or **本次新增设为试用** (Mark these additions as trials). Later acknowledges this exact set; a newer set can prompt again.

<p align="center"><img src="assets/screenshot-new-plugin.png?v=020-preview" width="540" alt="Current new-plugin prompt with restart, later and trial actions"></p>

Whether a restart is needed depends on the plugin and host loading behavior. **Restart interrupts running tasks; save your work first.**

## 02 · Keep a useful trail

History records observed additions, declared-version changes, removals and trial decisions, separately for each profile. It survives restarts and labels changes first noticed at startup.

<img src="assets/screenshot-history.png?v=020-preview" width="100%" alt="Plugin history with timestamps and old/new version declarations">

The first run establishes a baseline. Keeps 200 entries and displays the latest 100; unchanged manifest ranges with changed lockfile resolutions are not detected.

## 03 · Try it, then decide

Mark an installed plugin or a new group as a trial. On the next app boot, choose **保留** (Keep), **下次启动再问** (Ask next boot), or **移除** (Remove).

<img src="assets/screenshot-trials.png?v=020-preview" width="100%" alt="A trial awaiting the user's keep, defer or remove decision">

Keep ends the reminder. Removal needs a second confirmation and delegates to the native host manager; changed declarations require re-marking first. Trials do not isolate permissions or automatically uninstall packages. Protected or in-use plugins remain subject to host restrictions.

## 04 · Check reported startup state

Acceptance shows up to 30 recently changed plugins, or current plugins when there are no changes: active, failed, disabled, pending or unknown. Refresh reads current host state.

<img src="assets/screenshot-checks.png?v=020-preview" width="100%" alt="Dark-mode acceptance checklist showing active, failed and unknown examples">

Active means host entries are running. Business behavior and the actual loaded code version require separate verification. Missing reliable information stays unknown.

## A small button that stays out of the way

Drag it near an edge to snap; its position survives restarts. Open the panel with `Ctrl+Alt+B` (`Cmd+Alt+B` on macOS). Supports light/dark themes, zero runtime dependencies and MIT licensing. Web mode offers page refresh.

## Local data and compatibility

History, trials and logs stay on this machine, without conversation content or telemetry. A confirmed removal delegates package operations to the host, which may contact its configured registry.

All images are **real browser captures using mock data**, without real accounts or conversations. The cover presents the product concept; component close-ups show the actual client. Recreate them using the [preview instructions](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/preview/README.md).

Requires Node.js 20+ and DeepSeek Harness 0.2.0-rc.1+. Full restart needs the official Electron desktop app; inventory and native removal need host support. See the [development notes](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md) for configuration and local installation.

[Report an issue](https://github.com/kongkongya367-glitch/dsh-bingo-ren/issues) · [MIT License](LICENSE)
