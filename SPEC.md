# Bingo 开发说明

## 架构

- `lib/activity.js`：按 profile 隔离的变更记录、试用状态与宿主运行状态验收。
- `lib/index.js`：Cordis 宿主插件，负责注入、路由、插件清单检测和重启调度。
- `lib/restart-helper.cjs`：独立重启进程，仅结束指定的 shell/host PID，等待退出和端口释放，再启动应用。
- `preview/src/`：可读的客户端 JS/CSS；`npm run build` 生成 `client/` 发布文件。
- `preview/index.html`：使用模拟状态的离线预览。
- `test/`：宿主、客户端状态、重启 helper、安装脚本及 HTTP 集成检查。

运行时只使用 Node.js 内置模块和浏览器 API。

## 开发与验证

```sh
npm run build
npm test
node test/integration/mock-host.mjs
node test/integration/fake-desktop/run.mjs
npm pack --dry-run
```

完整重启验证必须使用临时的 fake shell/host，避免结束正在使用的桌面应用。测试状态目录与 profile 应指向临时目录，不修改真实 desktop profile。

fake-desktop 检查覆盖路由到 helper、结束旧进程和派生替代进程；替代程序是短暂运行的 Node.js，不代表真实桌面启动成功。helper 单测另行覆盖启动确认与失败重试。

## 宿主约定

页面注入必须在 `apply()` 开始时同步注册，服务就绪后再注册路由。加载器使用内联脚本创建客户端 script 标签，并处理加载失败。

接口：

| 接口 | 用途 |
| --- | --- |
| `GET /bingo/status` | 能力、待处理插件、最近重启状态 |
| `POST /bingo/restart` | 调度重启，仅桌面端且 `allowRestart` 开启时可用 |
| `POST /bingo/dismiss` | 按签名确认当前提醒 |
| `GET /bingo/client.js`、`/bingo/client.css` | 客户端资源 |

路由先校验回环 Host、Origin 与 fetch metadata，再委托可用的宿主 connection 校验。请求体最多 4 KB，不记录凭据。

## 检测与状态

profile 路径优先使用宿主服务，其次使用环境变量。状态目录默认为 `~/.dsh/bingo/`；测试用 `DSH_BINGO_HOME` 重定向。

依赖与 bundle 集合生成检测签名。新应用进程刷新基线；同进程热重组保留基线，并重新比较当前清单，避免漏掉触发重组的安装。文件监听与定时轮询并用，读取前等待写入稳定。

客户端暂停隐藏页面的轮询，失败时退避。重启遮罩随宿主状态恢复；在重启前发出的旧状态请求不能关闭新遮罩。

## 本地源码安装

优先使用独立测试 profile：

```sh
dsh plugin --profile bingo-selftest add link:/absolute/path/to/checkout
```

若需要本地桌面评估，先退出应用，再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-desktop.ps1
```

脚本保留清单备份；卸载只移除 Bingo 条目，不恢复整份旧配置。包目录若为 junction，仅删除链接。

## 发布边界

发布包只包含 `lib/`、`client/`、插件 patch、README、许可证、图标和预览图片。内部记录、测试、工具和临时目录不进入 npm 包。

公共文档及模拟数据使用示例路径，不写入个人用户目录或真实 profile 内容。发布流程见 [PUBLISH.md](PUBLISH.md)。

## 插件生命周期功能（0.2.0）

- `GET /bingo/activity` 返回变更记录、试用列表、可标记插件和验收状态；只在打开管理面板或手动刷新时读取宿主完整清单。
- `POST /bingo/trials` 支持 start、keep、snooze、remove。移除必须提交当前试用 ID 和 confirmed=true，声明版本必须仍然一致，并通过宿主 removable 检查。
- 使用公开的 pluginManager.listBundles/listPlugins/removeBundle。没有可靠服务时显示无法确认或引导原生插件页，不直接改写 profile 或删除包目录。
- 活动文件为状态目录下的 activity-<profile 哈希>.json，原子写入。保留 200 条历史、最多 100 个试用及 30 个验收目标。
- 同进程重组共享记录与移除互斥状态，避免旧请求覆盖记录或在移除期间重启。
- 运行状态与声明版本分别展示。文件存在、包版本可读不能证明插件已启动或新代码已加载。
- 客户端 JS/CSS 总预算调整为 52 KB，运行时仍无第三方依赖。

可选真实浏览器回归：`node test/browser-activity.mjs`（需要 Chromium/Edge 及支持全局 WebSocket 的 Node.js）。仅使用模拟页面和独立浏览器 profile，不操作真实应用。
