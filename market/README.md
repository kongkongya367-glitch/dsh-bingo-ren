# Market submission material

This directory holds copy-ready material for listing Bingo in the community plugin
directory [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).

**Nothing here has been submitted yet.** These are templates with explicit placeholders.

## What is real (checked 2026-10-19)

The directory no longer accepts README edits. A submission is **one YAML file** at:

```
data/plugins/<owner>__<repo>.yml
```

with this shape (format copied from the repository's `contributing.md`):

```yaml
url: https://github.com/owner/repo
name: owner/repo
category: ui
description:
  en: One-line description ending with a period.
  zh: 一句话描述，以句号结尾。
```

- `description.en` is the only required description; `zh` is optional.
- Category values include `ui`, `tools`, `usage`, `dev`, `workflow`, `fun`, and others.
- Screenshots are declared in **this plugin's own repository**, in a `screenshots.json`
  next to `package.json` (1–8 relative paths). Copy `screenshots.json` from this
  directory to the repository root before opening the PR.
- An npm package is optional for listing. If published, its `repository` field must
  point back at the listed repository.
- A PR may add at most 3 entries. This submission adds one.
- After merge, the two generated READMEs are rebuilt automatically; do not edit them.

## Files

| File | Purpose |
| --- | --- |
| `awesome-entry.yml` | Template for `data/plugins/<owner>__<repo>.yml`; replace placeholders. |
| `screenshots.json` | Copy to the repository root so the directory and storefronts pick up the screenshots. |
| `PR.md` | Suggested PR title and body, plus the checklist. |

See `../PUBLISH.md` for the full release order.
