# Bingo

**装完插件，Bingo 接班。**

> “你倒是重启一下啊。”
>
> 从替你记住那次重启，到记下插件变更、问你试用要不要留、展示启动后的运行状态，出事还能退回上一份清单。

[安装使用](#安装) · [版本与下载](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases) · [English](README.en.md)

<p align="center"><img src="assets/readme-hero.png?v=050-preview" width="100%" alt="Bingo：装完插件，Bingo 接班。装完提醒、变更留痕、先试再留、启动验收、装坏能退。"></p>

Bingo 是 **DeepSeek Harness 的插件善后管家**。它住在一枚可拖动的小按钮里，把插件装完之后容易忘记的几件事接起来。

你装插件，它记变化。你点“稍后”，它记住这一组。你把新插件标成试用，它在下次启动时再问一句：**留下，还是移除？** 重启之后，可以打开验收清单看运行状态；插件装坏了，还能退回上一份清单。

## 创意，在“装完之后”

装插件很容易，装完之后的小事却总要人记着。Bingo 围绕安装、复核与故障恢复设计：

| 你遇到的事 | Bingo 替你接上哪一步 |
| --- | --- |
| 装了新插件，转头就忘记重启 | 观察本地插件清单，发现新增就主动提醒 |
| 应用出了点问题，想不起最近动过什么 | 留下新增、版本变化、启用/停用和移除记录 |
| 随手装来试试，过几天忘记要不要留 | 标记试用，下次启动提醒你做决定 |
| 重启过了，还想确认插件现在的状态 | 读取宿主报告的运行状态，显示验收清单 |
| 装完反而打不开了 | 通过独立急救工具准备最小启动，之后按备份恢复 |
| 卸载之后还有目录留下 | 先勾选隔离，核对后恢复或永久删除 |
| 想知道为什么最近变慢 | 用同一口径看启动趋势，并对照插件变化 |
| 新版本有问题，想退回去 | 按变化前留下的检查点回滚插件清单 |

**提醒有记忆，变更有记录，试用有后续，启动有状态可看，装坏能退回去。**

## 安装

在 Harness 的 **设置 → 插件 → 添加插件** 中输入：

```text
dsh-bingo-ren
```

也可输入 GitHub 仓库地址：

```text
https://github.com/kongkongya367-glitch/dsh-bingo-ren
```

**安装或更新后，手动退出并重新打开 Harness 一次**，让新的界面加载。之后点击 **Bingo → 插件管家** 即可打开管理面板。

<details>
<summary>装到了旧版本，或看到“新版本观察期”？</summary>

宿主的 pnpm 安全策略可能暂缓选择刚发布的版本。可在应用内按提示指定精确版本（如 `dsh-bingo-ren@0.5.0`），或使用上面的 GitHub 地址安装。实际安装版本以安装结果为准。

运行中的 desktop profile 通过应用内插件页管理。CLI 开发安装请使用独立测试 profile，见 [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md)。

</details>

## 01 · 装完，有人提醒

不用回忆刚刚装过什么。Bingo 观察当前 profile 的插件清单，发现新增时主动弹出提醒。

- **立即 Bingo**：由你确认，重启整个桌面应用。
- **稍后**：记住当前这一组；同一组不重复提醒，再有新插件还会出现。
- **本次新增设为试用**：给这组插件留一个下次启动时再做决定的入口。

<p align="center"><img src="assets/screenshot-new-plugin.png?v=050-preview" width="540" alt="新版 Bingo 新插件提醒，包含立即重启、稍后和本次新增设为试用三个选择"></p>

是否必须重启取决于插件与宿主的加载方式。**重启会中断正在运行的任务，请先保存工作。**

## 02 · 装过什么，有迹可循

“最近是不是装了什么？”——打开变更记录就能回看。

记录新增、声明版本变化、启用/停用、移除，以及试用的开始与保留。记录按 profile 分开保存在本机，退出应用后仍然保留；应用关闭期间发生的变化，会在下次启动时标记为“启动时发现”。

<img src="assets/screenshot-history.png?v=050-preview" width="100%" alt="插件变更记录：清楚列出新增、版本变更与移除，并保留时间和前后版本">

从启用 Bingo 后开始记录，首次启用只建立基线。保存最近 200 条，界面展示最近 100 条。

## 03 · 先试，再决定留谁

给“我先装来试试”留一个后续。

在试用页选择已安装插件，或在新增提醒中直接标记这组插件。**下一次启动 Harness 时，Bingo 会提醒你决定：**

**保留 · 下次启动再问 · 移除**

<img src="assets/screenshot-trials.png?v=050-preview" width="100%" alt="临时试用：下次启动后显示待决定，并提供保留、下次启动再问和移除按钮">

“保留”结束提醒；“移除”需要再次确认，再交由 Harness 原生插件管理器执行。安装声明发生变化时，需要重新标记试用后才能移除。

试用是一种提醒机制，不隔离插件权限，也不会自动卸载插件。受到保护或仍被占用的插件，请按宿主提示处理。

## 04 · 启动之后，再看一眼

打开验收清单，把宿主报告的插件运行状态摆出来：

**运行中 · 加载失败 · 已禁用 · 等待启动 · 无法确认**

<img src="assets/screenshot-checks.png?v=050-preview" width="100%" alt="深色模式下的验收清单，分别展示运行中、加载失败和无法确认的示例状态">

优先展示最近变更的插件，最多 30 个；没有变更时展示当前插件。点“刷新”可重新读取状态。

“运行中”表示宿主条目已启动；业务功能和实际加载的代码版本仍需另行验证。缺少可靠信息时，清单会保留“无法确认”。

## 05 · 装坏了，能退回去

「恢复」负责最小启动和回滚；「残留清理」提供隔离与恢复；「启动体检」单独展示启动趋势。

### 回滚：退回装它之前

每次插件清单发生变化，Bingo 自动留下一个检查点（最近 8 个）。在「恢复」页选一个时间点，点「回滚到这里」再确认，Bingo 会按那份清单：

- 移除检查点里没有的插件
- 重装缺失或版本变了的插件
- 把启用状态改回检查点时的样子

**回滚只动插件清单和启用状态，插件自己的数据目录（`~/.dsh/<插件名>/`）保留。** 回滚完成后需要重启才会生效。

回滚全程走 Harness 原生插件管理器（`removeBundle` / `installBundle` / `setBundleEnabled`），不直接改 `package.json`。

### 最小启动：界面进不去，也有离线入口

<img src="assets/screenshot-recovery.png?v=050-preview" width="100%" alt="最小启动与独立离线急救入口，使用模拟数据">

在「恢复」页选择 **最小启动并重启**，再次确认后：

1. 完整备份当前 profile 的 `package.json` 和 `cordis.patch.yml` / `.yaml`，包含原来的格式与注释。
2. 独立 helper 等旧进程完全退出、端口释放后，才切换配置。
3. 仅保留 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与 Bingo，临时清空 profile 的自定义补丁。依赖仍保留，不卸载插件，也不删除插件数据。
4. 在最小启动中选择「恢复原配置并重启」，按备份还原。若后来编辑过其他配置，恢复会停止，保留这些新改动，并提供可读备份供核对。

此功能针对标准桌面 profile；启动器的全局/命令行覆盖层和宿主自身故障不在本次最小启动范围内。

**界面已经打不开时：** 在 Windows 的运行窗口或资源管理器中打开 `%USERPROFILE%\.dsh\bingo\救援`，完全退出 Harness 后，运行里面的 `Bingo-…-急救.cmd`，选择「最小启动」或「恢复原配置」。急救工具在之前正常加载 Bingo 时独立保存，即使安装包后来损坏，也不依赖正在运行的界面。自定义 `DSH_HOME` / `DSH_BINGO_HOME` 时，以恢复面板列出的路径为准。

若急救副本尚未生成，可从 GitHub Release 解压安装包，在完全退出应用后执行：

```powershell
node lib/rescue-cli.mjs enter --profile "你的 profile 完整目录" --closed --apply
node lib/rescue-cli.mjs restore --profile "你的 profile 完整目录" --closed --apply
```

`status` 为只读查看。Bingo 本身可能导致故障时，离线 `enter` 可加 `--without-bingo`，仅保留两个基础包，之后仍用离线工具恢复。备份可能包含原配置中的凭据，保存在本机私有目录，请勿提交或分享原始备份。

### 残留清理：先隔离，再决定永久删除

<img src="assets/screenshot-cleanup.png?v=050-preview" width="100%" alt="残留清理先列出候选，支持隔离、恢复和确认后永久删除">

「残留清理」页列出候选项，由你勾选后移入**同一磁盘的隔离区**。隔离后可恢复到原位置；原位置已有新文件时，会停止覆盖。明确不需要后，再次确认永久删除，才会释放磁盘空间。

扫描范围：至少静置 10 分钟的 `.ignored` 包副本、PID 已退出的 `*_tmp_<pid>_*` 临时目录，以及记录中已移除、与包名精确匹配且未在其他可读标准 profile 中安装的数据目录。大小计算有预算上限，未算完时显示估算或未知。

候选不等于已证实的垃圾，仍需核对用途。不会整目录删除 `.ignored`，不会根据“清单里没有”删除传递依赖，也不会把无规则的数据目录猜成某个插件的数据。符号链接、junction、链接祖先、正在使用的包路径和 Bingo 自身代码会被排除。隔离、恢复和删除共用宿主的 profile 写锁。

### 启动体检：用同一口径看趋势

<img src="assets/screenshot-health.png?v=050-preview" width="100%" alt="启动体检趋势与插件变更对照，数字为模拟数据">

打开「启动体检」，查看每次观测到的启动：耗时、清单包数、就绪时运行/失败条目数与异常组合包数，以及与上次启动相比的插件变化。记录按 profile 保存在本机，最多 60 次。

**耗时口径是“宿主进程启动 → Bingo 界面首次连接就绪”**，不包含完整 Electron 启动。使用单调计时；最小启动、热接入及观察点超过 2 分钟的样本单列，不混入普通启动平均值。宿主状态接口不可用时，失败数显示未知。

你能看到“新增某插件后，这次从 3.1 秒变成 5.8 秒”的对照；这只表示相关变化，不能证明该插件导致了变慢。Bingo 尚未加载的启动无法测量；未收到界面就绪确认的记录会显示未确认，不补造历史，也不直接判定启动失败。

### 重启记录：哪次、多长、动了谁

每次 Bingo 一下之后，都能在「恢复」页看到：

- **总耗时**、**停止旧进程**、**拉起新进程**三段分别是多久
- 平均耗时和至今最慢的一次
- 这次重启前后，有**哪些插件发生了变化**（新增 / 升级 / 移除）

数据来自 helper 写在 `~/.dsh/bingo/restart.log` 的真实时间戳，不是估算值。日志被轮转或删除后，更早的记录会消失——Bingo 只展示能拿出证据的部分。

## 和宿主共用写入边界

切换最小配置、隔离、恢复与永久删除使用宿主的 `package.json.lock` PID 写锁，并检查遗留的包管理进程。活锁和不明锁会拒绝操作；只对已证实退出的 PID 按宿主协议接管。`.pnpm/lock.yaml` 是持久文件，不代表正在安装。

回滚与旧版停用记录的恢复仍通过原生插件管理器执行，保留宿主自身的保护与 HMR 规则。新增最小启动统一走上面的配置备份与恢复流程。

## 一枚按钮，随手放

- 随手拖动，靠近边缘自动吸附，位置在重启后保留。
- `Ctrl+Alt+B` 随时打开面板；macOS 使用 `Cmd+Alt+B`。
- 适配浅色与深色主题；Web 模式提供页面刷新。
- 零运行时依赖，无遥测，MIT 开源。

<details>
<summary>查看重启面板、深色模式与拖动示例</summary>

<p align="center"><img src="assets/screenshot-panel.png?v=050-preview" width="400" alt="Bingo 重启面板及插件管家入口"></p>

<p align="center"><img src="assets/screenshot-panel-dark.png?v=050-preview" width="400" alt="深色重启面板"></p>

<p align="center"><img src="assets/screenshot-dragged.png?v=050-preview" width="440" alt="Bingo 拖动到右上角后重新定位的面板"></p>

</details>

## 本地记录，清楚边界

变更记录、试用状态、检查点、重启日志都保存在本机（`~/.dsh/bingo/`），不记录聊天内容，不发送遥测。用户确认执行插件操作时，由宿主管理器完成，可能访问其配置的注册表。

页面中的图片均为 **当前客户端在真实浏览器中的模拟数据预览**；无真实账号、聊天或安装数据。封面用于说明产品思路，组件特写来自实际界面。可用 [预览脚本](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/preview/README.md) 重拍。

<details>
<summary>配置、兼容性与排查</summary>

需要 **Node.js 20+** 与 **DeepSeek Harness 0.2.0-rc.1+**。完整重启依赖官方 Electron 桌面端；验收、原生移除、回滚和旧版停用记录恢复依赖宿主提供相应接口。最小启动要求标准桌面 profile 布局。能力缺失时，Bingo 会明确提示。

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
- 恢复页三个按钮都是灰的：说明插件管理器正在安装/更新，等它完成再试。
- 卸载：在 Harness 插件页移除 Bingo，再重启。源码安装的恢复方法见 [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md)。

</details>

[反馈问题](https://github.com/kongkongya367-glitch/dsh-bingo-ren/issues) · [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md) · [MIT License](LICENSE)
