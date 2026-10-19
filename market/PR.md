# 社区目录 PR 草稿

尚未提交。提交前核对目标仓库当前的贡献规则与 CI 要求。

## 标题

添加 dsh-bingo-ren：DeepSeek Harness 一键重启与插件提醒

## 正文

Bingo 为 DeepSeek Harness 添加一个可拖动的重启按钮。它支持靠近屏幕边缘自动吸附、记住位置，并在运行期间检测到新插件时提醒重启。

- 官方 Electron 桌面端支持整应用重启。
- 可选择稍后处理，同一组插件不重复提醒。
- 支持快捷键和深浅色主题。
- 零运行时依赖，不发送遥测，不向外发送数据。
- Web 模式禁用重启并提供刷新页面。
- 安装简介及默认文档使用中文，另附英文说明。

仓库：https://github.com/kongkongya367-glitch/dsh-bingo-ren

许可证：MIT

仅新增 `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml`。截图声明位于插件仓库根目录的 `screenshots.json`。

## 提交检查

- 仓库包含可安装代码与 `dsh.bundle.patch`。
- 仓库年龄与 topic 满足目标目录要求。
- `tarball` 链接可下载且版本正确。
- 截图路径有效，描述与实际行为一致。
