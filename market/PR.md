# PR draft — awesome-dsh-plugin submission

> **Status:** not opened. Replace `<owner>` / `<repo>` with the real GitHub
> repository first. Do not claim the plugin is listed until the PR is merged.

## PR title

```
Add dsh-bingo-restart
```

## PR body

```markdown
### What

Bingo adds a small button in the bottom-left corner of DeepSeek Harness. One click
in its panel restarts the whole desktop app. While the app runs, it watches the profile
manifest and offers the same restart when a new plugin is detected.

- Whole-app restart on the official Electron desktop app
- New-plugin detection with a centered confirmation dialog and per-signature "later"
- `Ctrl+Alt+B` / `Cmd+Alt+B` shortcut
- No runtime dependencies; no network access
- Web/headless mode: button visible, restart disabled, offers page refresh

Repo: https://github.com/<owner>/<repo>
License: MIT

### Entry

Adds one file, `data/plugins/<owner>__<repo>.yml`, in the format documented in
`contributing.md`. The plugin repository itself also declares `screenshots.json`.

### Checklist

Check each item before opening the PR. None of them is claimed as done while the
repository URL is still a placeholder.

- [ ] `package.json` declares `dsh.bundle.patch` (not only `dsh.client`)
- [ ] Repository contains working code, not a placeholder
- [ ] Repository is at least 1 day old at submission time
- [ ] Repository has the `dsh-plugin` topic
- [ ] Description states what the plugin does, without marketing superlatives
- [ ] Only one entry is added; no other entry is modified
- [ ] `screenshots.json` exists in the plugin repository with 1–8 images
```

## Steps

1. Replace placeholders in `awesome-entry.yml` and `screenshots.json`.
2. Copy `awesome-entry.yml` to `data/plugins/<owner>__<repo>.yml` in a fork.
3. Confirm `screenshots.json` is at the repository root (already added next to `package.json`); keep it in sync with `market/screenshots.json`.
4. Ensure the repo has the `dsh-plugin` topic and is at least one day old.
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
