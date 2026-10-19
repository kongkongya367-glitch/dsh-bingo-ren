# Bingo 预览

直接用浏览器打开 `preview/index.html`。页面返回模拟 `/bingo/*` 状态，不连接真实 profile，也不会重启应用。

| 参数 | 场景 |
| --- | --- |
| `?scene=button` | 默认按钮 |
| `?scene=panel` | 重启面板 |
| `?scene=panel-pending` | 面板中的新插件列表 |
| `?scene=pending` | 新插件弹窗 |
| `?scene=restarting` | 重启等待态 |
| `?scene=web` | Web 降级状态 |
| `?scene=history` | 插件变更记录 |
| `?scene=trials` | 待决定的试用插件 |
| `?scene=checks` | 运行状态验收 |
| `&theme=dark` | 深色主题 |
| `&dev=1` | 场景切换工具 |

## 构建

```sh
npm run build
```

可读源码位于 `preview/src/`，压缩产物位于 `client/`。客户端 JS/CSS 总大小预算为 52 KB。

## 重拍 README 预览

```sh
node preview/capture-readme.mjs
```

需要支持全局 WebSocket 的 Node.js（推荐 22+）和 Edge/Chromium。可通过 `BINGO_EDGE` 指定浏览器路径。脚本使用独立的 headless 浏览器 profile，直接拍摄当前 `client/` 界面并裁切到组件边界，不访问真实 Harness profile。

输出到 `assets/`：

- `readme-hero.png`：从 `readme-cover.html` 渲染的产品概览封面，其中面板图片来自实际客户端。
- `screenshot-new-plugin.png`：新插件提醒与试用入口。
- `screenshot-history.png`、`screenshot-trials.png`、`screenshot-checks.png`：插件管家三个页签。
- `screenshot-panel.png`、`screenshot-panel-dark.png`：新版重启面板。
- `screenshot-button.png`、`screenshot-dragged.png`：按钮与真实鼠标拖动后的面板位置。

上述图片均使用模拟数据，不包含真实账号、对话或插件清单。`render-screenshots.mjs` 是早期离线设计渲染脚本，当前 README 使用浏览器截图脚本。

封面用 HTML/CSS 排版，组件截图不改写运行时 UI。检查封面、中文字体、组件边界和各图片链接后再提交。
