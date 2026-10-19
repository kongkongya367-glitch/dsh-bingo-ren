# dsh-bingo-ren — 设计规格（唯一事实来源）

> 工作目录：`C:\\Users\\31461\\Desktop\\Bingo`
> 目标：给 DeepSeek Harness（官方 Electron 桌面端）加一个常驻左下角的 **Bingo** 按钮：一键整应用重启；检测到新装插件时提示「检测到新插件，是否要 Bingo 一下」；轻量、好看、可发布到社区插件市场。
> 状态：已调研完成，开始实现。**任何决定以本文件为准；实现中发现事实不符，先改 SPEC 再改代码。**

## 0. 硬约束（所有人必读）

1. **绝对不要**在当前正在运行的桌面端上调用重启接口/执行杀进程。当前会话就跑在这个 Electron 应用里，重启会杀死 Lead 与所有队友。
2. 不修改 `D:\\DeepSeekharness` 下任何文件；不修改用户 `~/.dsh/profiles/desktop` 的现有配置（验证用独立 profile / 临时目录）。
3. 不引入任何运行时 npm 依赖。插件 = 纯 Node ESM + 一个零框架浏览器脚本；运行时源码约 100–110 KB（client JS+CSS 约 35 KB），npm 整包约 550 KB（含 4 张设计预览图）。
4. 不改动 DSH 核心包；只用公开的 Cordis 上下文服务与 webServer 路由/注入 API。
5. 不要用 `alert/confirm/prompt`；客户端弹层全部自绘（Shadow DOM）。
6. 文件所有权见 §8。不要写别人 scope 的文件；需要改契约先在群里/SPEC 里说明。

## 1. 产品定义

- 名称：**Bingo**（包名 `dsh-bingo-ren`，npm 上 `dsh-bingo` 已被占用）。
- 位置：主窗口左下角，`position: fixed`，高 z-index，不遮挡关键操作；小屏/窄窗仍可用。
- 交互：
  - 单击 Bingo 胶囊 → 打开面板（锚定在按钮上方）。
  - 面板显示：状态（插件数/是否检测到新插件/上次重启）、主按钮「Bingo 一下」、次按钮「稍后」、快捷键提示。
  - 点击主按钮 → 立即整应用重启（不再二次确认；面板本身就是确认层）。文案明确「进行中的任务会中断」。
  - 检测到运行期间新装插件（profile 的 package.json 依赖集合变化）→ 自动弹出居中对话框：
    「检测到新插件，是否要 Bingo 一下？」+ 插件名/版本列表 + [立即 Bingo] [稍后]。
    同一签名只弹一次；「稍后」写入 ack，后续新插件再次触发。
  - 快捷键 `Ctrl+Alt+B`（macOS `Cmd+Alt+B`）也可以触发面板。
  - 非桌面运行方式（dsh web/headless）：按钮仍显示，主按钮禁用并解释「当前运行方式不支持整应用重启」；可提供「刷新页面」。
- 审美：极简、克制、DSH 原生感。浅色为默认，自动适配深色。参考设计语言：中性纸白/墨黑、1px 细边、柔和阴影、圆角 14–18px、字号 12–13px、字重 500–650、蓝色只做极少量强调。禁止大紫大红、禁止花哨渐变堆叠、禁止 emoji 图标（用内联 SVG）。
- 性能：客户端一个 Shadow Root、一个 4s 轮询（页面隐藏时暂停，失败指数退避至 30s）；CSS+JS 合计约 35KB（含拖拽/吸附）；宿主侧一个 4s `stat` 轮询 + `fs.watch` 即时触发，无依赖、无常驻大对象。

## 2. 关键事实（已在本机核实）

### 2.1 运行环境
- 官方桌面端：Electron shell `D:\\DeepSeekharness\\DeepSeek Harness.exe`（版本 0.2.1-rc.2），窗口加载 `dsh-app://app/`（**不是** http 页面）。
- shell 通过 `child_process.spawn` 启动 host 子进程：
  `D:\\DeepSeekharness\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js`
  argv 形如 `[--expose-internals, <entry>, <runtimeDir>, <projectDir>, <primaryRuntime>, <pnpm>, <nodeBin>]`，env 含 `ELECTRON_RUN_AS_NODE=1`。
  → 宿主插件可通过 `process.ppid` 拿到 Electron shell PID；`process.execPath` 就是桌面端 exe；`process.argv[1]` 以 `dsh-desktop-host/lib/index.js` 结尾。
- 页面里所有非静态请求由 shell 的 `protocol.handle("dsh-app")` → `forwardWebRequest` 转发到 host（127.0.0.1:随机端口），**转发时删除 origin/host/cookie，改写成 shell 持有的鉴权 cookie**。因此插件注册的 `/bingo/*` 路由从桌面页面可直接 `fetch('/bingo/...')`。
- shell 的 IPC 白名单只接受 host 的 `ready/fatal/shutdown-complete/platform-session/update-tasks/quit-inspection`，**没有 restart 消息**；`app.relaunch()` 只在开发菜单、更新安装、崩溃恢复对话框里出现。桌面端设置里的“重启”能力由 shell 独占且未暴露给插件（dshmarket 在桌面分支明确 `allowRestart:false`）。
  → **结论：整应用重启只能由插件派生一个脱离进程树的 helper：杀掉 Electron shell PID → 等旧进程退出/端口释放 → 重新启动 exe。** 这是本插件的核心难点，helper 必须独立存活、可诊断、失败可恢复。
- 页面侧注入：桌面端 index.html 由静态 dist 直出，不走 `renderIndex`；host 在启动时把 `ctx.webServer.collectIndexInjections()` 的结果经 IPC 交给 shell，页面 boot 脚本逐行应用（`dsh-web-frontend/dist/assets/index-*.js` 的 `PZ`）：
  - `global`、`script`（textContent，不 await）、`script-src`（**加载失败会 reject 整个 boot**）、`style`、`html`。
  → **只能用 `script` 行内联一个加载器**，自己创建 `<script src="/bingo/client.js">` 并吞掉 onerror（与 dsh-whale-widget 的 issue #154 修复一致）。不可用 `script-src` 行。
  - 注入表在 host 启动时**只收集一次**：注入行必须在 `apply()` 最开头同步注册，不能等 `ctx.inject([...])` 里的服务就绪（竞态会导致桌面端永远不出现）。
- web 形态（`dsh web`）走 `renderIndex`，结构化注入行同样会渲染；另可加 `tapIndex` 兜底老版本。两条通道都要去重。
- 路由 API：`ctx.webServer.register({ kind: 'exact', path, handler(req,res) })` 返回 disposer；`ctx.webServer.tapIndex(fn)`；`ctx.webServer.port`。
- 可信栅栏：`ctx.get('connection')?.requestRejection(req)`（可能不存在）。dsh-whale-widget 已验证的简化顺序：
  1) 插件自校验：`Host` 必须可解析；若 Host 非回环，只有在宿主栅栏可用时才交给栅栏（否则 403）；`sec-fetch-site: cross-site` → 403；出现 `Origin` 时必须与 Host 同源（桌面转发没有 Origin，正常通过）；校验器抛错 → 403。
  2) 有 `connection.requestRejection` 就委托；抛错 → 403；返回非空 → 用其状态码。
- 注入表（IndexInjection）行：`{ kind:'script', placement:'body', text:'...' }`（placement 直接使用；whale 用 'body'）。

### 2.2 新插件检测
- 桌面 profile 目录优先级（A 已实现并验证）：`ctx.get('profileContext')?.dir` → `ctx.get('desktopProfiles')?.current?.dir` → `process.env.DSH_PROFILE_DIR` → `path.join(DSH_HOME || ~/.dsh, 'profiles', DSH_PROFILE || 'desktop')`。**懒解析**：每次 /status 与检测都重新取，服务晚挂载时自动切换并从实际 profile 重建基线，避免把全部插件误报为新增。
- 插件安装会修改 profile 的 `package.json`：`dependencies` 增加包，`dsh.profile.bundles` 增加 bundle。以 `JSON.stringify(sorted deps entries)` 作为签名（另把 bundles 一起算入，避免漏掉 bundle-only 变化）。
- 状态目录：`process.env.DSH_BINGO_HOME || path.join(DSH_HOME || ~/.dsh, 'bingo')`（测试/沙箱必须可用环境变量重定向；真实运行默认 `~/.dsh/bingo`）。基线文件 `state.json`（`{ baselineSignature, baselinePackages, acknowledgedSignature, lastRestart }`）。**启动时无条件把基线更新为当前状态**（应用关闭期间装的插件已经生效，无需提示）。
- 运行期：每 4s `stat` package.json；mtime+size 变化 → 等 1.2s 再读（避开 pnpm 半写入）→ 计算新签名 → 与基线比较，新增依赖 = pending。
- ack：用户点「稍后」→ 记录 `acknowledgedSignature`；pending 只在 `signature !== acknowledgedSignature` 时上报。
- 状态接口缓存结果；不阻塞请求。

### 2.3 可借鉴的本机实现
- `C:\\Users\\31461\\.dsh\\profiles\\desktop\\node_modules\\dsh-whale-widget\\lib\\index.js`：注入行 + 路由 + 栅栏 + 桌面适配的实战注释（L706–746、L4891–4924）。**实现前必读。**
- `C:\\Users\\31461\\.dsh\\profiles\\desktop\\node_modules\\dshmarket\\lib\\restart.js`：宿主机自重启 helper 的完整实现（等待端口释放、日志、超时、恢复），可借鉴思路；但它重放的是 dsh CLI，不适用于桌面 shell。
- SDK 已解包在 `C:\\Users\\31461\\Desktop\\Bingo\\.research\\sdk\\`（webServer、desktop-shell、plugin-manager、web-frontend 等）；`tools/asar.cjs` 可读 app.asar（需 `ELECTRON_RUN_AS_NODE=1` + 桌面 exe）。

## 3. 架构

**单宿主插件 + 页面注入脚本，不使用 dsh.client 客户端模块。**

理由：
- 桌面端注入表是官方支持的通道，whale 已验证；
- 不依赖 React/客户端模块加载器/UI slot 版本，跨版本更稳；
- 体积最小（无打包器、无 React）。
- 宿主插件负责：注入、鉴权接口、检测、重启 helper。
- 客户端脚本负责：按钮/面板/弹层/轮询/重启等待态。

## 4. 文件与包结构

```
Bingo/
  package.json                 # C（包名 dsh-bingo-ren，零依赖）
  cordis.patch.yml             # C（bundle patch insert）
  README.md / README.zh.md     # C（发布门面）
  LICENSE                      # C（MIT）
  icon.svg                     # C（市场图标）
  assets/                      # B（截图、预览资产）
  lib/index.js                 # A（宿主插件，ESM）
  lib/restart-helper.cjs       # A（独立 helper，CommonJS，Electron-as-node）
  client/bingo-client.js       # B（浏览器 IIFE，无依赖）
  client/bingo-client.css      # B（通过 <link> 注入 Shadow Root）
  preview/index.html           # B（本地预览/截图用，mock fetch）
  scripts/                     # C（安装/发布说明脚本，可选）
  market/                      # C（awesome-dsh-plugin 收录条目/PR 文案）
  test/                        # A: host.test.mjs, restart-helper.test.mjs；B: client-*.mjs
  SPEC.md                      # Lead
```

## 5. 宿主插件契约（A 实现，B/C 依赖）

入口 `lib/index.js`，ESM，`export const name = 'dsh-bingo-ren'`、`export const inject = []`（对象级 inject 会延迟 apply，**禁止**）、`export function apply(ctx, config)`。

### 5.1 apply 顺序（必须）
1. 同步注册注入行订阅（`ctx.on('webserver/index-inject', table => ...)`），并立刻 push 行；行文本见 §5.4。
2. `ctx.inject(['webServer'], hostCtx => { ...注册路由、tapIndex、定时器、effect disposer... })`；`connection` 是可选服务，**按请求** `ctx.get('connection')` 动态取（硬依赖会让缺该服务的宿主完全不激活）；无 connection 时栅栏 fail-closed。
3. 在 effect dispose 时清理 interval、订阅、路由。
4. A 的补充（已实现）：status 额外返回 `confirm`；helper 支持 `testTimings` 测试钩子；Windows 强杀先 `taskkill /F /PID`（按 SystemRoot 解析绝对路径），被拒则回退 `process.kill(pid,'SIGKILL')`，仍只针对单个数字 PID。

### 5.2 配置文件 `config`（全部可选，带默认值）
```ts
{
  enabled?: boolean,          // false = 不注入/不路由（默认 true）
  pollMs?: number,            // 检测轮询，默认 4000，限制 1500–60000
  confirm?: boolean,          // 默认 true；false 时点按钮直接重启（仍保留面板）
  allowRestart?: boolean,     // 默认 true；false 强制禁用（运维逃生开关）
  position?: 'bottom-left' | 'bottom-right', // 默认 bottom-left（通过 global 注入传给客户端）
  debug?: boolean
}
```

### 5.3 HTTP 路由（exact）
所有路由先过 §2.1 的可信栅栏；任何拒绝返回 403/401，不返回细节。
- `GET /bingo/status` → 200 JSON：
```json
{
  "ok": true,
  "version": "0.1.0",
  "desktop": true,
  "canRestart": true,
  "restarting": false,
  "pollMs": 4000,
  "position": "bottom-left",
  "profile": { "name": "desktop", "dir": "C:\\Users\\..." },
  "pending": { "signature": "sha256:...", "packages": [{"name":"dsh-xxx","version":"1.2.3"}], "detectedAt": "ISO" },
  "lastRestart": { "at": "ISO", "trigger": "button", "ok": true, "log": "C:\\...\\bingo\\restart.log" }
}
```
  `pending` 无则 `null`。`canRestart = desktop && config.allowRestart`。
- `POST /bingo/restart` body `{ "trigger": "button" | "new-plugin" | "shortcut" }`（可空）→ 202 `{ok:true,scheduled:true}`；重复请求/正在重启 → 409 `{ok:false,code:'restarting'}`；不可重启 → 409 `{ok:false,code:'unsupported'}`；helper spawn 失败 → 500 `{ok:false,code:'spawn-failed',message}`。
- `POST /bingo/dismiss` body `{signature}` → 匹配当前 pending：200 `{ok:true}`；无 pending 或签名不符：409 `{ok:false,code:'no-pending'}`。
- `GET /bingo/client.js` → `application/javascript; charset=utf-8`，`Cache-Control: no-store`，内容按 mtime 缓存。
- `GET /bingo/client.css` → `text/css; charset=utf-8`，`Cache-Control: no-store`。
- `GET /bingo/icon.svg` → `image/svg+xml`（可选；客户端可内联图标，优先内联）。
- 未知 `/bingo/*` → 404。

请求体解析：上限 4KB，非法 JSON → 400。响应统一 `Content-Type: application/json; charset=utf-8` + `Cache-Control: no-store`。

### 5.4 注入行（桌面唯一通道）
在 `apply()` 里同步 push（每个 table 只别重复）：
```js
{
  kind: 'script',
  placement: 'body',
  text: `(function(){try{
    if(window.__DSH_BINGO_LOADED__)return;
    var d=document.body||document.head||document.documentElement;if(!d)return;
    var s=document.createElement("script");
    s.src="/bingo/client.js?v=${encodeURIComponent(String(version))}";
    s.async=true;s.onerror=function(){};
    d.appendChild(s)
  }catch(e){}})()`
}
```
- 去重：table 中已有包含 `/bingo/client.js` 的行则跳过。
- 另外注册 `ctx.webServer.tapIndex(html => ...)`，在 web 形态给 `</body>` 前插 `<script defer src="/bingo/client.js?v=..."></script>`，已有则跳过（老版本兼容）。
- 可选 `global` 行：`{kind:'global', name:'__DSH_BINGO_POSITION__', value: position}`（客户端优先读 status，global 仅作首屏提示）。

### 5.5 重启 helper（A 的核心）
宿主侧（`lib/index.js`）：
```js
const helper = path.join(dirname(fileURLToPath(import.meta.url)), 'restart-helper.cjs')
const cfg = {
  shellPid: process.ppid,          // Electron main
  hostPid: process.pid,
  appExe: process.execPath,
  appDir: path.dirname(process.execPath),
  port: ctx.webServer.port,
  logPath: path.join(process.env.DSH_BINGO_HOME || path.join(home, 'bingo'), 'restart.log'),
  trigger,
  delayMs: 650,
  createdAt: new Date().toISOString(),
}
const child = spawn(process.execPath, ['--expose-internals', helper, Buffer.from(JSON.stringify(cfg)).toString('base64url')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  detached: true, stdio: 'ignore', windowsHide: true,
})
child.unref()
```
- 只能由桌面宿主触发：`isDesktopHost = Boolean(process.versions.electron) && /dsh-desktop-host[\\/]lib[\\/]index\.js$/.test(String(process.argv[1]||''))`。
- 状态置 `restarting=true` 并持久化 lastRestart（先写 attempt，helper 成功与否由 helper 日志补充）。
- 如果 `spawn` 同步抛错 → 500 + 复位状态。

Helper（`lib/restart-helper.cjs`，CommonJS，在 Electron-as-node 中执行）：
1. 解析 argv[2] base64url JSON；打开日志（append，超过 256KB 轮转为 .1）。
2. 记录阶段：start → sleep(delayMs) → kill shellPid（`process.kill(pid)`，Windows 下即 TerminateProcess；ESRCH 视为成功）。
3. 等待（最多 15s）：shellPid 与 hostPid 都不存在（`process.kill(pid,0)` 抛 ESRCH）、且 `port` 已拒绝连接（net.connect 500ms 超时）。每 250ms 一次。
4. 若超时：Windows 用 `taskkill /F /PID` 强杀 shell/host；再等 3s。
5. 启动新应用：`spawn(appExe, [], { cwd: appDir, detached: true, stdio: 'ignore', windowsHide: false, env: cleanEnv })`；cleanEnv 删除 `ELECTRON_RUN_AS_NODE`、`ELECTRON_NO_ATTACH_CONSOLE`、`NODE_OPTIONS`、`DSH_DESKTOP_NODE_EXECUTABLE`、`DSH_SHELL`、`DSH_SESSION_ID`、`DSH_WEB_URL`（保留 DSH_HOME/DSH_PROFILE）。
6. 记录 replacement pid；轮询最多 20s 确认端口能连上（新 host 随机端口，不一定等于旧 port；所以仅记录 spawn 成功，不阻塞太久）。helper 退出码 0。
7. 任何异常都写日志；若在 kill 之后启动失败，尝试再启动一次（间隔 1s）。
8. **安全**：只杀 `shellPid`/`hostPid` 两个数字 PID，绝不 kill 进程名/进程树（/T 会杀掉 helper 自己）。helper 本身 `detached` 且 `unref`。
9. 测试钩子：cfg 支持 `testLaunch: { file, args }`（仅测试用）替换 appExe；生产不传。
10. 日志格式：`[ISO] stage message`；lastRestart 结果由下次启动时读取日志尾部（可选，不阻塞）。

### 5.6 导出纯函数（供测试）
`export function computeSignature(pkgJson)`、`export function diffPackages(baseline, current)`、`export function isDesktopHost(argv1, versions)`、`export function resolveProfileDir(env, ctx)`、`export function buildFence(connection)`。保持无副作用，便于 Node 直接 import 测试。

## 6. 客户端契约（B 实现）

- 文件：`client/bingo-client.js`（IIFE，严格模式，ES2020，无 import）、`client/bingo-client.css`。
- 幂等：`if (window.__DSH_BINGO_LOADED__) return; window.__DSH_BINGO_LOADED__ = true`。
- 挂载：`document.body` 存在即挂；Shadow DOM host `#dsh-bingo-host`（`position:fixed` 容器），`attachShadow({mode:'open'})`，内部 `<link rel="stylesheet" href="/bingo/client.css?v=...">` + 根节点。
- 状态：启动立即 `GET /bingo/status`，之后按 `pollMs`（4s）轮询；`document.hidden` 时暂停，`visibilitychange` 恢复；失败指数退避 2→4→8…最大 30s。请求超时 5s（AbortController）。
- 失败（接口 404/网络错误）：隐藏按钮（插件宿主可能未加载完成）或显示降级按钮？**约定：前 2 次失败静默，持续失败隐藏 UI**，避免破坏宿主页面。
- 按钮：
  - 44px 高胶囊，圆角 999px，左侧 18px。内联 SVG 四角星/闪电 + 文本 “Bingo”；有 pending 时右侧 6px 琥珀点。
  - `aria-label="Bingo：重启 DeepSeek Harness"`，`title` 提示 `Ctrl+Alt+B`。
  - 点击打开面板，不直接重启。
- 面板（锚定按钮上方 10px，宽 312px）：
  - 顶部：Bingo 标识 + 版本 + 关闭 ×。
  - 状态行：桌面端「Harness 桌面端 · 可重启」/ Web「当前为 Web 运行方式」。
  - 若有 pending：高亮块列出新插件名+版本，文案「检测到新插件」。
  - 主按钮「Bingo 一下」；副按钮「稍后」；下方 11px 灰色提示「会中断正在进行的任务，约 3 秒恢复」。
  - 上次重启时间/结果（有则显示，弱化）。
- 自动弹层（新插件）：居中卡片 360px + 遮罩 blur(6px)，标题「检测到新插件，是否要 Bingo 一下？」；列出最多 6 个插件（更多折叠 +N）；按钮 [立即 Bingo] [稍后]；ESC/遮罩点击=稍后（写入 ack）；同一 `pending.signature` 每个页面会话只自动弹一次（内存 Set + 服务端 ack 双保险）。
- 重启中：按钮进入 loading（旋转弧线），面板按钮禁用，显示「正在 Bingo…」；同时全屏轻遮罩显示「正在重启 Harness，页面会自动恢复」；轮询失败后显示手动启动提示（12s 后）。
- 非 desktop / canRestart=false：主按钮禁用，说明原因；Web 模式下提供「刷新页面」次按钮（`location.reload()`）。
- 主题：默认浅色；`@media (prefers-color-scheme: dark)` + 侦测 `html[data-theme]`/`html[data-ds-theme-source]`/`html.dark` 切换深色变量；用 CSS 变量。
- 可访问性：按钮可 Tab 聚焦、Enter/Space 触发、ESC 关面板/弹层、focus-visible 轮廓；弹层打开时焦点进入首个按钮，关闭后归还。
- 预览：`preview/index.html` 模拟 DSH 页面（左侧栏 + 对话区 + 输入框），覆盖 `window.fetch` 返回 mock status（含 pending 场景的 URL 参数），加载真实 `client/bingo-client.js/css`；供 Edge headless 截图。
- 截图（B 产出到 `assets/`）：`screenshot-button.png`、`screenshot-panel.png`、`screenshot-new-plugin.png`（1440×900 或 1280×800，浅色；可选 dark）。
- 约束：不读宿主 DOM 结构、不依赖 Tailwind/React、不使用网络请求（除 /bingo/*）。

## 7. 打包 / 发布（C 实现）

- `package.json`：name `dsh-bingo-ren`（已确认 npm 未占用；`dsh-bingo` 被占），version 0.1.1，type module，main `lib/index.js`，files `["lib","client","cordis.patch.yml","README.md","README.zh.md","LICENSE","icon.svg","assets"]`，零 dependencies，`engines: { node: ">=20", dsh: ">=0.2.0-rc.1" }`（market 用它显示兼容），keywords 至少含 `dsh-plugin`, `deepseek-harness`, `dsh`, `restart`, `bingo`, `plugin-manager`。
- `dsh.bundle.patch: "./cordis.patch.yml"`；**不要**设置 `dsh.client`（本插件无客户端模块）。
- `cordis.patch.yml`：
```yaml
- insert:
    - id: dsh-bingo-ren
      name: dsh-bingo-ren
      config:
        enabled: true
```
- README（中英双语）：一句话价值、截图、安装（设置 → 插件 → 添加插件 → 输入 `dsh-bingo-ren`；或 `dsh plugin --profile <name> add dsh-bingo-ren`）、使用、首次安装需手动重启一次、快捷键、安全说明（重启会中断任务）、隐私（不联网）、兼容性、卸载、License。
- 市场：插件目录是 `awesome-dsh-plugin/awesome-dsh-plugin`（GitHub），上架方式是给该仓库提 PR 增加条目；dshmarket 每次打开实时读 `https://awesome-dsh-plugin.com/plugins.json`。C 需要抓取该仓库当前 README/条目格式，产出 `market/awesome-entry.yml` 或可粘贴条目 + `PUBLISH.md`（npm publish + PR 步骤 + 截图位置）。不得杜撰实际已上架。
- `scripts/install.ps1`：本地开发安装到一个**非 desktop** 的自测 profile（示例 `dsh-plugin --profile bingo-selftest add link:<本目录>`），不碰运行中的 desktop profile；注释说明正式安装走插件设置。
- `icon.svg`：单色/双色极简四角星 + 字母 B？要求 24–512 可缩放、深色背景可读；另导出 `assets/icon-512.png`（可用 Edge headless 渲染 SVG 截图，或 PowerShell/Inkscape 若有）。
- 许可证 MIT，作者字段可写 `Bingo Contributors`，repository 可留占位（不得编造真实 URL；用 `https://github.com/your-name/dsh-bingo-ren` 并标注需替换）。
- 发布产物：`npm pack --dry-run` 通过；包内不含 test/preview/.research/SPEC（可用 .npmignore 或 files 白名单）。

## 8. 任务与写权限

| 任务 | 负责人 | 写 scope | 依赖 |
|---|---|---|---|
| A 宿主 + helper | host-engine | `lib/**`, `test/host*.mjs`, `test/restart-helper*.mjs`, `test/fixtures/**` | SPEC |
| B 客户端 UI + 预览/截图 | client-ui | `client/**`, `preview/**`, `assets/screenshot-*.png`, `test/client*.mjs` | SPEC（先按契约做，不必等 A） |
| C 打包/文档/市场 | packaging-market | `package.json`, `cordis.patch.yml`, `README*.md`, `LICENSE`, `icon.svg`, `assets/icon-512.png`, `scripts/**`, `market/**`, `PUBLISH.md`, `CHANGELOG.md`, `.gitignore`, `.npmignore` | SPEC |
| D 独立验证 | verifier（Lead 后派） | `verification/**` | A+B+C |

Lead 保留：`SPEC.md`, `test/integration/**`, 最终集成修改权、最终验收。

## 9. 验证要求

- A：`node --test test/host.test.mjs test/restart-helper.test.mjs` 全绿；restart helper 用 **fake shell/host** 进程验证 kill→wait→launch（testLaunch 写 marker），**绝不**对真实 Electron 调用。
- B：`preview/index.html` 用 Edge headless 截图成功；截图检查：无遮挡、浅深色可读、面板/弹层/加载态齐全；`node --check client/bingo-client.js`。
- C：`npm pack --dry-run` 输出检查；README 命令正确；无虚构数据。
- Lead 最终：用 mock webServer + 真实 HTTP 挂载插件跑通 status/restart(仅校验拒绝逻辑)/dismiss/client.js；检查所有文件；给出安装说明。
- **真实桌面重启只能由用户点击触发**；Lead/队友不得在本会话内实际重启应用。

## 10. 风险与对策

1. **杀 shell 后新实例起不来**（单实例锁/端口/文件占用）→ helper 等待 pid 退出 + 端口释放 + 15s 超时强制清理 + 日志 + 二次启动尝试。
2. **helper 被进程树连带杀死** → detached + unref + 只按 PID 杀，绝不用 taskkill /T。
3. **注入失败导致整个页面 boot 失败** → 只用 `script` 行内联加载器 + onerror 吞掉；client.js 404 不影响宿主。
4. **注入表竞态** → apply 开头同步注册行。
5. **安全** → 同源/回环/宿主栅栏三重检查；POST 只接受 JSON；不返回敏感路径（profile.dir 可返回，已在本机）。
6. **市场兼容** → 无依赖、无客户端模块、只用 webServer/connection 可选服务；旧宿主缺 index-inject 时 tapIndex 兜底。
7. **误报新插件** → 启动即刷新基线；mtime 变化后延迟 1.2s 二次确认；只比较 dependencies+bundles。
8. **审美翻车** → B 提供截图，Lead 按 §1 标准验收；必要时返工。

## 11. 参考文件索引

- `.research/sdk/desktop-shell/main.js`：L12406 protocol.handle / L8268 forwardWebRequest / L12424 boot IPC / L11844 & L12772 app.relaunch。
- `.research/sdk/dsh-desktop-host/lib/index.js`：host 启动、collectIndexInjections、IPC shutdown。
- `.research/sdk/dsh-host-webserver/lib/index.js`：L369 tapIndex、L326 register、L522 collectIndexInjections、L29 renderRow。
- `.research/sdk/dsh-web-frontend/dist/assets/index-CN7NIWNw.js`：搜索 `script-preload`（PZ 行应用器）。
- `dsh-whale-widget/lib/index.js`：注入行/路由/栅栏/桌面注释（本机 node_modules）。
- `dshmarket/lib/restart.js`：自重启 helper 参考。
- `dshmarket/README.zh.md` L96–108：上架途径与数据源。