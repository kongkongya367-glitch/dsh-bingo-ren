# Bingo

**装完插件，下一步也有人接住。**

> 装完忘了重启？装了十几个插件启动越来越慢？新版本把东西弄坏了？
>
> Bingo 记着每一步，也留好了退路。

Bingo 是 DeepSeek Harness 的插件善后管家：提醒重启、检查运行状态、决定试用去留，遇到问题再找变更记录和恢复入口。

[安装](#安装) · [版本与下载](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases) · [English](README.en.md)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

<img src="assets/readme-hero.png?v=060" width="100%" alt="Bingo：装完插件，下一步也有人接住">

## 打开就知道，接下来做什么

以前要在多页之间找功能，现在收成 **4 个入口**：

| 入口 | 帮你完成的事 |
| --- | --- |
| **概览** | 把新增待重启、试用待决定、宿主报告的加载异常集中起来，直接前往处理 |
| **插件** | 搜索插件名，筛选异常、试用、最近变更与禁用项；在同一行看运行状态、标记试用或决定去留 |
| **变更记录** | 回看新增、声明版本变化、启用／停用、移除和试用决定 |
| **恢复与工具** | 配置回滚、最小启动、离线急救；需要时再打开残留隔离和启动趋势 |

<img src="assets/screenshot-overview.png?v=060" width="100%" alt="概览集中显示待重启、加载异常与试用决定，并提供下一步操作">

### 少找一页，少选一次

在插件列表里直接搜索、查看状态并标记试用。下一次启动时，试用提醒让你决定：**保留、下次再问，还是确认移除**。试用不会隔离权限或自动卸载。

列表按异常优先显示，覆盖当前清单中的最多 1000 个插件；“最近变更”单独筛选，不再让异常插件受旧的 30 项验收目标范围限制。

<img src="assets/screenshot-plugins.png?v=060" width="100%" alt="插件列表整合搜索、状态筛选和逐项试用操作">

**运行中**只表示宿主条目已启动，业务功能与实际加载代码版本仍需验证。宿主缺少可靠信息时显示**无法确认**。

### 求助时，先生成一份能用的摘要

概览中的 **生成排查摘要 → 复制摘要**，整理包名、声明版本、宿主报告状态和近期变更。生成后可先核对，再复制给维护者。

摘要不读取聊天或配置，不带 profile 路径、日志路径或原始错误文本；本地依赖与自定义下载来源的地址会省略。插件清单本身也可能透露使用习惯，分享前由你核对。剪贴板不可用时可选中文本手动复制。Bingo 不会自动发送摘要。

## 安装

Harness 的 **设置 → 插件 → 添加插件**，输入：

```text
dsh-bingo-ren
```

也可使用仓库地址：

```text
https://github.com/kongkongya367-glitch/dsh-bingo-ren
```

**首次安装或更新后，手动退出并重新打开 Harness 一次。** 点击 Bingo 小按钮，再进入「插件管家」。新版本观察期可能影响自动选择版本，可按宿主提示指定 `dsh-bingo-ren@0.6.0`，实际安装结果以应用显示为准。

需要 Node.js 20+、DeepSeek Harness 0.2.0-rc.1+。完整重启依赖官方 Electron 桌面端。重启会中断当前任务，请先保存工作。

## 原来的小按钮，依然顺手

- 检测 profile 新增插件，主动提醒重启。点“稍后”记住当前这一组，再有新增继续提醒。
- 拖动、贴边、记住位置；`Ctrl+Alt+B` 唤起面板，macOS 使用 `Cmd+Alt+B`。
- 支持深浅主题；Web 模式提供页面刷新。
- 普通查看只加载主要界面；进入「恢复与工具」才加载高级界面。只有打开残留隔离时，新客户端才请求候选扫描。

## 出问题时，按顺序找线索

先看**概览的异常**，再看**最近变更**；需要恢复时进入 **恢复与工具**。

<img src="assets/screenshot-recovery.png?v=060" width="100%" alt="恢复配置、最小启动与独立离线急救入口">

<details>
<summary>回滚：退回之前的插件清单</summary>

<img src="assets/screenshot-recovery.png?v=060" width="100%" alt="恢复页：配置回滚与最小启动入口">

每次观察到清单变化，保留变化前的检查点（最近 8 个）。确认后通过宿主原生插件管理器增删包、恢复已记录的版本声明与启用状态；插件数据目录保留。完成后需要重启。

0.6.0 修正了启用状态在活动清单及检查点中丢失的问题，新记录会保留这项信息。旧记录中缺失的启用状态无法追溯：恢复已安装包时保留当前启用选择，不凭空假设它过去启用了。

</details>

<details>
<summary>最小启动与离线急救：界面进不去时使用</summary>

先完整备份 profile 的 `package.json`、`cordis.patch.yml` / `.yaml`；独立 helper 等旧 shell、宿主与端口退出后，才切换配置。最小启动只保留 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和 Bingo，暂时清空 profile 自定义补丁，不卸载依赖，不删除插件数据。

之后可按备份恢复，包含原格式与注释。遇到备份方案之外的新配置改动时拒绝覆盖。此功能针对标准桌面 profile，全局／命令行覆盖层与宿主本身故障不在处理范围。

Windows 独立急救入口在正常加载时提前保存：打开 `%USERPROFILE%\.dsh\bingo\救援`，完全退出 Harness，再运行 `Bingo-…-急救.cmd`。自定义 `DSH_HOME` / `DSH_BINGO_HOME` 时，以面板显示的路径为准。独立副本不依赖安装包之后是否完好。

若副本尚未生成，可从 Release 解压安装包，在完全退出应用后运行：

```powershell
node lib/rescue-cli.mjs enter --profile "你的 profile 完整目录" --closed --apply
node lib/rescue-cli.mjs restore --profile "你的 profile 完整目录" --closed --apply
```

`status` 为只读；`enter --without-bingo` 可只保留两个官方基础包。备份可能包含原配置凭据，应保存在本机，不要上传原始备份。

旧版 profile 范围的停用记录仍可确认恢复；更早的无 profile 标识记录不自动归属，核对插件名后在原 profile 手动恢复，见 [开发说明](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md)。

</details>

<details>
<summary>残留隔离：先能撤销，再考虑删除</summary>

<img src="assets/screenshot-cleanup.png?v=060" width="100%" alt="残留隔离：候选列表、移入隔离区与恢复">

在「恢复与工具」选择「残留隔离与恢复」。扫描至少静置 10 分钟的 `.ignored` 副本、PID 已退出的临时包目录，以及记录中已移除、名称精确匹配且未在其他可读标准 profile 中安装的数据目录。大小可能只是估算。

候选仍需核对用途。勾选后移动到同卷隔离区，可恢复；原位置已有新内容时停止覆盖。隔离不释放磁盘空间，再次确认永久删除后才释放。不会整目录删除 `.ignored`，不会按“清单里没有”删除传递依赖，不跟随符号链接或 junction 祖先，保护活动引用和 Bingo 自身代码。

</details>

<details>
<summary>启动趋势：同一观测点下对照变化</summary>

<img src="assets/screenshot-health.png?v=060" width="100%" alt="启动趋势：每次启动的耗时与插件变化对照">

在工具选择「启动趋势」。保存最近 60 次观测，口径是**宿主进程启动到 Bingo 界面首次连接就绪**，不包含完整 Electron 启动。显示就绪时的包数、运行／失败条目与异常包数，并对照插件变化。

最小启动、热接入和观察点超过 2 分钟的样本单列，不计入普通启动均值。未知状态保持未知，没有界面确认不等于启动失败。耗时和插件变化只供关联对照，不证明哪个插件导致变慢，也不补造历史。

</details>

## 本地记录，清楚边界

变更记录按 profile 保存在本机：最近 200 条，界面显示 100 条；首次启用只建立基线。应用关闭期间的变化，下次启动标记为“启动时发现”。版本范围不变、只有锁文件解析结果变化的更新暂不记录。

Bingo 零运行时依赖、无遥测，MIT 开源。插件安装、移除和回滚交由宿主管理器，可能访问其配置的注册表。写入操作共用宿主 PID 写锁，拒绝活动或不明占用；持久的 `.pnpm/lock.yaml` 不算正在安装。

图片来自当前客户端的真实浏览器模拟数据，不包含真实账号或配置。完整兼容性、配置项、排查与开发安装方式见 [SPEC.md](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/SPEC.md)，预览方式见 [preview/README.md](https://github.com/kongkongya367-glitch/dsh-bingo-ren/blob/main/preview/README.md)。

[反馈问题](https://github.com/kongkongya367-glitch/dsh-bingo-ren/issues) · [版本下载](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases) · [MIT License](LICENSE)
