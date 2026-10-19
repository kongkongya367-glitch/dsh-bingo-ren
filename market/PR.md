# PR draft — awesome-dsh-plugin submission

> **Status:** not opened. The repository is public, has the `dsh-plugin`
> topic, and has a `v0.1.1` Release. The PR is waiting for the awesome-dsh-plugin
> CI age rule (the repository was created at 2026-10-19 05:50 UTC and must be
> one day old). Do not claim the plugin is listed until the PR is merged.

## PR title

```
Add dsh-bingo-ren
```

## PR body

```markdown
### What

Bingo adds a draggable button to DeepSeek Harness. It snaps to the nearest edge
and remembers its position; one click in its panel restarts the whole desktop app.
While the app runs, it watches the profile manifest and offers the same restart
when a new plugin is detected.

- Whole-app restart on the official Electron desktop app
- New-plugin detection with a centered confirmation dialog and per-signature "later"
- `Ctrl+Alt+B` / `Cmd+Alt+B` shortcut
- No runtime dependencies; no network access
- Web/headless mode: button visible, restart disabled, offers page refresh

Repo: https://github.com/kongkongya367-glitch/dsh-bingo-ren
License: MIT

### Entry

Adds one file, `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml`, in the format documented in
`contributing.md`. The plugin repository itself also declares `screenshots.json`.

### Checklist

Check each item before opening the PR. The repository URL is set; the remaining
checks depend on the pushed repository and its settings.

- [x] `package.json` declares `dsh.bundle.patch` (not only `dsh.client`)
- [x] Repository contains working code, not a placeholder
- [ ] Repository is at least 1 day old at submission time (created 2026-10-19 05:50 UTC)
- [x] Repository has the `dsh-plugin` topic
- [x] Description states what the plugin does, without marketing superlatives
- [x] Only one entry is added; no other entry is modified
- [x] `screenshots.json` exists in the plugin repository with 1–8 images
```

## Steps

1. Confirm the repository URL and entry path in `awesome-entry.yml` (already set).
2. Copy `awesome-entry.yml` to `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml` in a fork.
3. Confirm `screenshots.json` is at the repository root (already added next to `package.json`); keep it in sync with `market/screenshots.json`.
4. The `dsh-plugin` topic is set; wait until the repository is at least one day old (2026-10-20 05:50 UTC).
5. Open one PR against `main` that adds only the entry file.
6. Wait for CI: entry count, `dsh.bundle` check, repo age, awesome-lint, site build.
7. After merge, the site rebuilds automatically; no further action.

## Repository requirements (from contributing.md)

- `package.json` declares a `dsh.bundle` manifest. Bingo declares
  `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`.
- Real, working code and active maintenance.
- Repo created at least 1 day before submission.
- `dsh-plugin` GitHub topic.
- Accurate descriptions, no superlatives.
- Screenshots: 1–8 images, relative paths inside the plugin directory, declared in
  `screenshots.json`; absolute URLs must be GitHub-hosted https.
