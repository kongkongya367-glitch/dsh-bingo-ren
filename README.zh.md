# Bingo —— 给 DeepSeek Harness 的一键重启按钮

DeepSeek Harness（dsh）左下角常驻一枚安静的 **Bingo** 按钮。点开面板，再点一下「Bingo 一下」，整个桌面端就会重启；运行期间装了新插件，Bingo 会主动提醒你重启。

- **整应用重启** —— 结束 Electron shell 与宿主进程，等旧实例退出并释放端口，再重新启动应用。
- **新插件检测** —— 运行期间监视 profile 清单；出现新依赖时弹出居中对话框。选「稍后」只确认当前这一组签名，之后再有新插件仍会提醒。
- **快捷键** —— `Ctrl+Alt+B`（macOS 为 `Cmd+Alt+B`）打开面板。
- **零运行时依赖** —— 纯 Node ESM + 一个浏览器脚本；不用 React、不用打包器、没有依赖树。
- **原生质感** —— 中性纸白/墨黑、1px 细边、柔和阴影、默认浅色并自动适配深色；内联 SVG 图标，无 emoji。
- **Web/无头环境安全** —— 在桌面 shell 之外仍有页面时，按钮仍会显示，但重启禁用，面板会解释原因并提供「刷新页面」。

**[English →](README.md)**

## 界面预览

| 按钮 | 面板 | 检测到新插件 |
| --- | --- | --- |
| <img src="assets/screenshot-button.png" width="280" alt="左下角 Bingo 按钮"> | <img src="assets/screenshot-panel.png" width="280" alt="Bingo 面板"> | <img src="assets/screenshot-new-plugin.png" width="280" alt="新插件对话框"> |

以上是**离线设计预览**：与 `preview/index.html` 使用同一套几何尺寸与模拟数据渲染，不是真实 profile 的浏览器实拍。深色面板见 <a href="assets/screenshot-panel-dark.png">这张图</a>；`preview/README.md` 附了在任何未受限机器上一行命令重拍真实截图的步骤。

## 安装

### 桌面端

1. 打开 **设置 → 插件**。
2. 点 **添加插件**。
3. 输入 `dsh-bingo-restart` 并确认。
4. **手动重启一次 DeepSeek Harness**（退出后重新打开）。

这是向运行中的桌面端安装的唯一受支持方式：应用独占自己的 `desktop` profile，并拒绝来自独立 CLI 进程的包操作。请勿使用 `dsh plugin --profile desktop …`，桌面端安装一律走应用内的插件页。

第 4 步只在首次安装时需要：按钮由插件自己注入，还没加载的插件无法重启自己。完成这一次手动重启后，后续都交给 Bingo 按钮。

### dsh CLI（Web 与自测 profile）

包发布之后，CLI 只用于**非运行中桌面端**的 profile，例如 `dsh web` 或一次性的自测 profile：

```sh
dsh plugin --profile bingo-selftest add dsh-bingo-restart
```

需要 `dsh` CLI 在 `PATH` 中。开发时安装本地目录：

```sh
dsh plugin --profile bingo-selftest add link:/absolute/path/to/this/checkout
```

`scripts/install.ps1` 会把这种开发安装包进一个**独立的自测 profile**，并拒绝碰 `desktop`。若 Windows 拦截未签名脚本，请用 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1` 运行。

### 未发布前的本地安装（高级）

如果 npm 上还没有这个包，又想在真实桌面 profile 里试用 Bingo，请在**退出 DeepSeek Harness 之后**使用本地安装脚本（仅限源码 checkout；`scripts/` 不会打进 npm 包）：

```powershell
# 只预览：打印每一步改动，不写任何文件
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -WhatIf

# 把当前目录复制进 desktop profile 并注册
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1

# 恢复备份的 profile 清单，并删除复制进去的包
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -Uninstall
```

参数：`-DshHome <目录>`（默认取 `$env:DSH_HOME` 或 `~/.dsh`）、`-ProfileName desktop`（高级用法，也可指定其他 profile）、`-Force`（跳过运行中进程检查）。

脚本行为：

- 检测到 DeepSeek Harness 进程时拒绝执行，除非显式传 `-Force`；
- 把 `<profile>/package.json` 备份为 `package.json.bingo-backup`，追加依赖与 bundle 条目，并把当前目录复制到 `<profile>/node_modules/dsh-bingo-restart`；
- 不执行 `npm publish`，不杀进程、不重启应用，只动指定的 profile。`-Uninstall` 会恢复备份、删除复制进去的包，并保留备份以便再次恢复。

这是高级的本地评估路径，不是正式安装；包发布之后，正式路径仍是 设置 → 插件。

## 使用

1. 点 **Bingo**（或按 `Ctrl+Alt+B`）打开面板。面板显示能否重启、待处理的新插件与上次重启结果。
2. 点 **Bingo 一下** 立即重启。面板本身就是确认层，不会再问第二次。
3. **稍后** 会按签名记住当前这组新插件，同样的插件不会再次弹出；之后再装新插件仍会提醒。

检测到新插件时会弹出居中对话框，列出新包名与版本：

- **立即 Bingo** → 同样执行整应用重启。
- **稍后** / `Esc` / 点击遮罩 → 确认当前签名，继续工作。

如果在应用运行期间刚装完插件，首次提醒可能正是指这次安装：确认后手动重启一次即可。

## 配置

所有配置项都可选，写在 profile 的 `cordis.patch.yml` 中 `dsh-bingo` 行下：

```yaml
- id: dsh-bingo
  config:
    enabled: true          # false = 不注入按钮、不注册路由
    pollMs: 4000           # profile 轮询间隔，1500–60000
    confirm: true          # 宿主接受；0.1.0 始终先打开面板确认
    allowRestart: true     # false = 强制禁用，运维逃生开关
    position: bottom-left  # 或 bottom-right
    debug: false
```

0.1.0 中面板始终是确认层；`confirm` 会被宿主接受，但暂不会跳过面板。

## 安全

重启是真正的重启：Electron shell 与宿主进程会被结束，应用重新启动。**正在进行的任务会中断**，面板在点击前已明确提示。重启 helper 的行为边界：

- 只按 PID 结束传给它的两个进程（加载它的 shell 与其宿主进程），绝不按进程名杀、绝不用进程树（`/T`）；
- 等待旧实例退出并释放端口，带超时与日志兜底；
- 以 detached 方式启动独立 helper，在应用退出后存活并重新拉起应用；
- 诊断写入 `~/.dsh/bingo/restart.log`，检测状态保存在 `~/.dsh/bingo/state.json`。

在 `dsh web` 或无头模式下不会杀任何进程：重启禁用，面板改提供「刷新页面」。

## 隐私

Bingo **不发起任何对外网络请求**。它只访问页面同源、走回环 web server 的 `/bingo/*` 自有路由，并读取本地 profile 的 `package.json` 来发现新装插件。没有遥测，不加载第三方资源。

## 兼容性

- DeepSeek Harness **0.2.0-rc.1 及以上**（`engines.dsh`），Node.js **20 及以上**。
- 完整整应用重启：官方 Electron 桌面端。
- 降级模式：`dsh web` / 会提供页面的无头宿主 —— 按钮可见，重启禁用。
- 只使用公开的 Cordis webServer 与 index 注入接口，不修改 DSH 核心或任何已安装包。

## 卸载

1. 打开 **设置 → 插件**，找到 **Bingo** 并移除。桌面端 profile 只能走这条路径。
2. 非桌面 profile 可以用 CLI：`dsh plugin --profile <profile> remove dsh-bingo-restart`。
3. 若用高级本地脚本安装，请先退出应用，再运行 `scripts/install-local-desktop.ps1 -Uninstall`。
4. 重启一次应用，按钮与路由随之消失。

可选清理：删除 `~/.dsh/bingo/`（检测基线、确认记录、重启日志）。

## 排查

- **安装后没有按钮** —— 手动重启一次；首次加载无法追溯注入。确认 设置 → 插件 中已启用。
- **按钮可见但重启禁用** —— 当前是 Web/无头模式；用面板里的刷新。
- **重启没反应** —— 查看 `~/.dsh/bingo/restart.log`，helper 会记录 start、kill、wait、relaunch 各阶段。
- **新插件没有提醒** —— 每次应用启动都会刷新基线；关闭应用期间装的插件会被视为已生效，不再提醒。

## 许可证

[MIT](LICENSE)

---

> **发布状态（占位符已显式标注）：** Bingo **尚未发布**。计划以 `dsh-bingo-restart` 发布（`dsh-bingo` 已被占用），但尚未发布到 npm，也**未被**社区插件目录收录。`package.json` 中的 repository/homepage/bugs 仍使用 `your-name` 占位符，发布前必须替换。详见项目仓库中的 `PUBLISH.md`。
