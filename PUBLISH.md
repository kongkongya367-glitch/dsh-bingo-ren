# Publishing Bingo

This document is the release runbook. **GitHub is published; npm and the community listing are not.**
Bingo is not on npm and is not listed in the community plugin directory.

> Do not run `npm publish` from a shared session. Publish only after the release
> owner has replaced the placeholders and approved the tarball.

## 1. Current state

| Item | State |
| --- | --- |
| Package name | `dsh-bingo-ren` (chosen because `dsh-bingo` is already taken on npm) |
| npm | **Not published** (no npm login in this environment) |
| Community directory | **Not submitted**; draft only in `market/` (repo must be 1 day old) |
| Repository URL | `https://github.com/kongkongya367-glitch/dsh-bingo-ren` (pushed) |
| GitHub release | `v0.1.1` published with `dsh-bingo-ren-0.1.1.tgz` asset |
| Version | `0.1.1` |

## 2. Remaining release actions

Repository URLs and the GitHub release are configured. Remaining actions are npm sign-in/publish and the community PR:

| File | Field / text | Replace with |
| --- | --- | --- |
| `package.json` | `repository.url`, `homepage`, `bugs.url` | Set to `kongkongya367-glitch/dsh-bingo-ren` |
| `README.md`, `README.zh.md` | "Release status" block | Updated to the real repository; still says npm unpublished |
| `market/awesome-entry.yml` | `url`, `name` | Set to `kongkongya367-glitch/dsh-bingo-ren` |
| `market/PR.md` | repository URL and entry path | Set |
| `market/screenshots.json` | — | Keep it in sync with the repository-root `screenshots.json` (already added) |
| `CHANGELOG.md` | release date / notes | Keep accurate; never claim unpublished states |

The `author` field is intentionally generic (`Bingo Contributors`). Replace it with
the release owner's name or organisation if desired.

## 3. Pre-flight

Requirements: Node.js 20+, npm 9+, the final `lib/` and `client/` files from the
implementation tasks, and the five screenshots in `assets/`.

```sh
# 1. Syntax gates
node --check lib/index.js
node --check client/bingo-client.js

# 2. The tarball must succeed and contain only the published surface
npm pack --dry-run

# 3. Inspect the exact file list for build leftovers
npm pack --dry-run --json

# 4. Assert the forbidden paths are absent (test, preview, .research, SPEC.md)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/pack-check.ps1
```

The tarball must include `lib/`, `client/`, `cordis.patch.yml`, both READMEs,
`LICENSE`, `icon.svg`, `assets/` (icon and screenshots). It must **not** include
`test/`, `preview/`, `.research/`, `verification/`, `SPEC.md`, `scripts/`,
`market/`, `PUBLISH.md`, or `CHANGELOG.md`.

```sh
# 5. Re-check the name before publishing
npm view dsh-bingo-ren version
# On 2026-10-19 this returned 404 (name free); dsh-bingo exists at 0.0.1.
# A version here on publish day means the name was taken in the meantime and
# the package name must be changed first. Re-check; never guess.
```

Install-test the packed tarball in a **separate self-test profile**, never in the
running `desktop` profile:

```sh
npm pack
dsh plugin --profile bingo-selftest add ./dsh-bingo-ren-0.1.1.tgz
```

The running desktop app owns its `desktop` profile: install there through
**Settings → Plugins**, never with `dsh plugin --profile desktop …`. For a
pre-release local desktop evaluation, quit the app first and run
`scripts/install-local-desktop.ps1 -WhatIf`, then the same script without
`-WhatIf` (advanced; it edits the real desktop profile and `-Uninstall`
restores the backup).

## 4. Version and changelog

1. First release: keep `0.1.1`, the version this package is prepared for.
2. For later releases: move the `[Unreleased]` notes in `CHANGELOG.md` under the
   new version and date.
3. Commit, then tag after publishing: `git tag v0.1.1 && git push --tags`.

## 5. npm publish (not executed)

```sh
npm login
npm whoami
npm pack --dry-run

# Real publish — release owner only
npm publish --access public

# Verify
npm view dsh-bingo-ren version dist.tarball engines.dsh
```

If two-factor authentication is enabled, npm prompts for a one-time password.
Never put an npm token in this repository, in a script, or in chat.

## 6. Community directory PR

The directory is [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
It is generated from `data/plugins/*.yml`; README edits are rejected.

1. Copy `market/awesome-entry.yml` to `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml` in a fork,
   replacing every placeholder.
2. Confirm `screenshots.json` is at this repository's root (already added; keep it
   in sync with `market/screenshots.json` when regenerating images). The directory
   reads screenshots from the plugin's own repository.
3. Make sure the repository has the `dsh-plugin` GitHub topic and is at least one
   day old; CI checks repo age.
4. Open one PR that adds **only** your entry file (max 3 entries per PR).
5. Use the title/body from `market/PR.md`.
6. CI checks: entry shape, `dsh.bundle` manifest, repo age, awesome-lint and site
   build. After merge, the site and the market index rebuild automatically.

Only after the PR is merged may the plugin be described as "listed". Storefronts
such as `dshmarket` read the community index, so installability from the app's
Discover/plugin market follows the merge, not the npm publish.

## 7. After publishing

- [ ] `npm view dsh-bingo-ren` shows the expected version and repository link (pending npm publish)
- [x] Fresh install into a self-test profile works
- [x] README "Release status" block updated to the GitHub repository/release and the npm gap
- [x] GitHub release `v0.1.1` created with the tarball asset
- [x] `market/awesome-entry.yml` `tarball:` points at the published release asset
- [x] Issue tracker and discussion links work

## 8. If something is wrong

- Within npm's unpublish window and with no dependent packages:
  `npm unpublish dsh-bingo-ren@<version> --force`.
- Otherwise deprecate the bad version:
  `npm deprecate dsh-bingo-ren@<version> "reason"` and publish a patch.
- Do not hand-edit the generated READMEs in the directory. Fix your own
  `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml` and open a follow-up PR.