# 社区目录 PR 草稿

尚未提交。提交前核对目标仓库当前的贡献规则与 CI 要求。

## 标题

Add dsh-bingo-ren

## 正文

Bingo adds a draggable restart button to DeepSeek Harness. It remembers its position, snaps near screen edges, and prompts when new plugins are added while the app runs.

- Whole-app restart on the official Electron desktop app.
- Per-signature dismissal of new-plugin prompts.
- Keyboard shortcut and light/dark themes.
- Zero runtime dependencies and no outbound network requests.
- Web mode offers page refresh with restart disabled.

Repository: https://github.com/kongkongya367-glitch/dsh-bingo-ren

License: MIT

Adds only `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml`. Screenshots are declared in the plugin repository's root `screenshots.json`.

## 提交检查

- 仓库包含可安装代码与 `dsh.bundle.patch`。
- 仓库年龄与 topic 满足目标目录要求。
- `tarball` 链接可下载且版本正确。
- 截图路径有效，描述与实际行为一致。
