# Bingo 开发说明

## 架构

- `lib/activity.js`：按 profile 隔离的变更记录、试用状态与宿主运行状态验收。
- `lib/index.js`：Cordis 宿主插件，负责注入、路由、插件清单检测和重启调度。
- `lib/host-support.js`：宿主与路径适配、来源栅栏、注入、HTTP、状态和 helper 调用等基础函数；原有具名测试导出仍由入口转发。
- `lib/plugin-management.js`：变更/试用、验收及恢复操作的组合层；以访问器读取当前 profile，共享同一启动中的原生操作互斥状态，不反向导入入口。
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

## 恢复与体检（0.5.0）

- rescue.js/local-state.js/rescue-cli.mjs：逐文件原子备份与恢复，共用宿主 PID 写锁，helper 在旧实例释放后应用方案；正常加载时部署独立急救副本。配置出现本次方案之外的变动时拒绝覆盖，已知的部分应用状态可恢复。
- quarantine.js：固定范围、稳定扫描 ID、同卷隔离、冲突停止、确认后永久删除；保护 junction 祖先、活跃引用、其他可读 profile 和 Bingo 自身代码。索引先记意图再移动，重启后识别中断状态。不触碰真实 profile 做写入验证。
- health.js：每个 host boot 建立观测记录，客户端 POST /bingo/ready 确认连接；以单调进程时钟计时，口径不包含完整 Electron 启动。统计普通启动均值，最小启动和晚接入另列。缺失宿主信息保留未知。
- 新路由 GET /bingo/health、POST /bingo/ready、POST /bingo/rescue；POST /bingo/cleanup 使用候选 IDs 和 isolate/restore/purge 动作。所有写入动作都需要 confirmed=true，并经过同一来源栅栏。
- 测试包含临时目录、跨进程 helper、原配置字节恢复、配置冲突、符号链接、跨 profile 数据保护、清理恢复与启动口径；真实用户 profile 仅做只读冒烟。

## 结构整理（0.6.0）

- 旧 `/bingo/safe-mode` 进入路由已移除，新最小启动只走 rescue。已有 `safe-mode-<profile 哈希>.json` 仍可从恢复页显式确认恢复，对应 `POST /bingo/rescue` 的 `action: restore-legacy`；只重新启用记录中的插件，不创建新停用记录。
- 旧状态的读取不产生 profile 写入。恢复与回滚共用操作互斥，部分失败保留剩余项；最小启动与旧记录恢复使用独立的界面确认状态。
- 更早的、未标注 profile 的 `safe-mode.json` 不自动归属或删除。可核对其中插件名后，在原 profile 的宿主插件页手动重新启用，避免把其他 profile 的旧记录应用到当前 profile。
- 删除不再参与运行的旧扫描/忙碌判定代码及其专属测试；真实 profile 冒烟检查只调用当前 quarantine 扫描器与 native PID guard。


## 四入口工作流（0.6.0）

- 概览聚合新增提醒、待决定试用、宿主报告失败与直接下一步。插件页统一试用与状态，支持名称搜索、异常／试用／最近变更／禁用筛选；完整状态范围最多 1000 项，原 30 项 acceptance 字段仍兼容旧客户端。
- `GET /bingo/activity` 新增 plugins；等待宿主快照期间 profile 变化会拒绝返回错配结果。客户端按 bootId 使旧活动请求失效，并保留搜索焦点与光标位置。
- 主客户端按需加载 `GET /bingo/tools.js`。高级工具失败不阻塞主要功能；恢复视图使用 `GET /bingo/recovery?scan=0`，选择隔离清理才请求扫描。所有资源继续使用同一来源栅栏。初始资源预算 65 KB，高级代码预算 16 KB。
- 排查摘要只从允许的包名、版本、状态与变更字段组装；不读取聊天、配置、日志。自定义来源地址省略；复制前可预览，剪贴板失败时选中原文手动复制，不自动发送。
- 活动清单与检查点保留已知 enabled 状态；旧记录缺失时先建立新基线，不补造启用／停用事件。回滚不把历史未知状态当作“启用”；重装时优先保留已知目标或当前选择。
