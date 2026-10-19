# Bingo

**装完插件，Bingo 接班。**

> “你倒是重启一下啊。”
>
> 从替你记住那次重启，到记下插件变更、问你试用要不要留、展示启动后的运行状态。

[安装使用](#安装) · [版本与下载](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases) · [English](README.en.md)

<p align="center"><img src="assets/readme-hero.png?v=020-preview" width="100%" alt="Bingo：装完插件，Bingo 接班。装完提醒、变更留痕、先试再留、启动验收。"></p>

Bingo 是 **DeepSeek Harness 的插件善后管家**。它住在一枚可拖动的小按钮里，把插件装完后容易忘记的几件事接起来。

你装插件，它记变化。你点“稍后”，它记住这一组。你把新插件标成试用，它在下次启动时再问一句：**留下，还是移除？** 重启之后，还可以打开验收清单看看运行状态。

## 创意，在“装完之后”

装插件很容易，装完之后的小事却总要人记着。Bingo 围绕四个真实场景设计：

| 你遇到的事 | Bingo 替你接上哪一步 |
| --- | --- |
| 装了新插件，转头就忘记重启 | 观察本地插件清单，发现新增就主动提醒 |
| 应用出了点问题，想不起最近动过什么 | 留下新增、声明版本变化和移除记录 |
| 随手装来试试，过几天忘记要不要留 | 标记试用，下次启动提醒你做决定 |
| 重启过了，还想确认插件现在的状态 | 读取宿主报告的运行状态，显示验收清单 |

**提醒有记忆，变更有记录，试用有后续，启动有状态可看。**

## 安装

在 Harness 的 **设置 → 插件 → 添加插件** 中输入：

```text
dsh-bingo-ren
```

也可输入 GitHub 仓库地址：

```text
https://github.com/kongkongya367-glitch/dsh-bingo-ren
```

**安装或更新后，手动退出并重新打开 Harness 一次**，让新的界面加载。之后点击 **Bingo → 插件记录 · 试用 · 验收** 即可打开插件管家。

<details>
<summary>装到了旧版本，或看到“新版本观察期”？</summary>

宿主的 pnpm 安全策略可能暂缓选择刚发布的版本。可在应用内按提示指定 `dsh-bingo-ren@0.2.0`，或使用上面的 GitHub 地址安装。实际安装版本以安装结果为准。

运行中的 desktop profile 通过应用内插件页管理。CLI 开发安装请使用独立测试 profile，见 [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md)。

</details>

## 01 · 装完，有人提醒

不用回忆刚刚装过什么。Bingo 观察当前 profile 的插件清单，发现新增时主动弹出提醒。

- **立即 Bingo**：由你确认，重启整个桌面应用。
- **稍后**：记住当前这一组；同一组不重复提醒，再有新插件还会出现。
- **本次新增设为试用**：给这组插件留一个下次启动时再做决定的入口。

<p align="center"><img src="assets/screenshot-new-plugin.png?v=020-preview" width="540" alt="新版 Bingo 新插件提醒，包含立即重启、稍后和本次新增设为试用三个选择"></p>

是否必须重启取决于插件与宿主的加载方式。**重启会中断正在运行的任务，请先保存工作。**

## 02 · 装过什么，有迹可循

“最近是不是装了什么？”——打开变更记录就能回看。

记录新增、声明版本变化、移除，以及试用的开始与保留。记录按 profile 分开保存在本机，退出应用后仍然保留；应用关闭期间发生的变化，会在下次启动时标记为“启动时发现”。

<img src="assets/screenshot-history.png?v=020-preview" width="100%" alt="插件变更记录：清楚列出新增、版本变更与移除，并保留时间和前后版本">

从启用 Bingo 后开始记录，首次启用只建立基线。保存最近 200 条，界面展示最近 100 条。

## 03 · 先试，再决定留谁

给“我先装来试试”留一个后续。

在试用页选择已安装插件，或在新增提醒中直接标记这组插件。**下一次启动 Harness 时，Bingo 会提醒你决定：**

**保留 · 下次启动再问 · 移除**

<img src="assets/screenshot-trials.png?v=020-preview" width="100%" alt="临时试用：下次启动后显示待决定，并提供保留、下次启动再问和移除按钮">

“保留”结束提醒；“移除”需要再次确认，再交由 Harness 原生插件管理器执行。安装声明发生变化时，需要重新标记试用后才能移除。

试用是一种提醒机制，不隔离插件权限，也不会自动卸载插件。受到保护或仍被占用的插件，请按宿主提示处理。

## 04 · 启动之后，再看一眼

打开验收清单，把宿主报告的插件运行状态摆出来：

**运行中 · 加载失败 · 已禁用 · 等待启动 · 无法确认**

<img src="assets/screenshot-checks.png?v=020-preview" width="100%" alt="深色模式下的验收清单，分别展示运行中、加载失败和无法确认的示例状态">

优先展示最近变更的插件，最多 30 个；没有变更时展示当前插件。点“刷新”可重新读取状态。

“运行中”表示宿主条目已启动；业务功能和实际加载的代码版本仍需另行验证。缺少可靠信息时，清单会保留“无法确认”。

## 一枚按钮，随手放

- 随手拖动，靠近边缘自动吸附，位置在重启后保留。
- `Ctrl+Alt+B` 随时打开面板；macOS 使用 `Cmd+Alt+B`。
- 适配浅色与深色主题；Web 模式提供页面刷新。
- 零运行时依赖，无遥测，MIT 开源。

<details>
<summary>查看重启面板、深色模式与拖动示例</summary>

<p align="center"><img src="assets/screenshot-panel.png?v=020-preview" width="400" alt="Bingo 0.2.0 重启面板及插件管家入口"></p>

<p align="center"><img src="assets/screenshot-panel-dark.png?v=020-preview" width="400" alt="深色重启面板"></p>

<p align="center"><img src="assets/screenshot-dragged.png?v=020-preview" width="440" alt="Bingo 拖动到右上角后重新定位的面板"></p>

</details>

## 本地记录，清楚边界

变更记录、试用状态与日志保存在本机，不记录聊天内容，不发送遥测。用户确认移除时，由宿主管理器执行包管理操作，可能访问其配置的注册表。

页面中的图片均为 **当前客户端在真实浏览器中的模拟数据预览**；无真实账号、聊天或安装数据。封面用于说明产品思路，组件特写来自实际界面。可用 [预览脚本](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/preview/README.md) 重拍。

<details>
<summary>配置、兼容性与排查</summary>

需要 **Node.js 20+** 与 **DeepSeek Harness 0.2.0-rc.1+**。完整重启依赖官方 Electron 桌面端；验收与原生移除依赖宿主提供相应接口。接口不可用时，Bingo 会显示无法确认或引导到原生插件页。

可在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: dsh-bingo-ren
  config:
    enabled: true
    pollMs: 4000           # 1500–60000 毫秒
    allowRestart: true
    position: bottom-left # 或 bottom-right
    debug: false
```

当前版本始终先显示面板确认。版本变更依据清单声明；版本范围不变、只有锁文件解析版本变化的更新暂不记录。

- 没有按钮：手动重启一次，确认插件已启用。
- 重启失败：查看 `~/.dsh/bingo/restart.log`。
- 验收显示无法确认：检查宿主是否提供运行状态，或到原生插件页查看。
- 卸载：在 Harness 插件页移除 Bingo，再重启。源码安装的恢复方法见 [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md)。

</details>

[反馈问题](https://github.com/kongkongya367-glitch/dsh-bingo-ren/issues) · [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md) · [MIT License](LICENSE)
