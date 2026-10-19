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

## 截图

`assets/` 中的按钮、面板、新插件弹窗和深色面板是离线设计渲染，脚本为 `render-screenshots.mjs`；`screenshot-dragged.png` 是模拟页面的浏览器截图。截图中的聊天、账号和插件列表均为示例。

可在仓库根目录用 Edge 重新拍摄预览：

```powershell
$edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
$previewRoot = (Get-Location).Path
$previewUrl = ([System.Uri](Join-Path $previewRoot 'preview\index.html')).AbsoluteUri
$previewProfile = Join-Path $env:TEMP ('bingo-preview-' + [guid]::NewGuid().ToString('N'))
& $edge --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 --virtual-time-budget=2000 --user-data-dir=$previewProfile --allow-file-access-from-files --screenshot="$previewRoot\assets\screenshot-panel.png" "$previewUrl`?scene=panel"
```

浏览器路径可按安装位置调整。拍摄前确认使用的是模拟页面，检查面板边界、文字对比度及截图背景。
