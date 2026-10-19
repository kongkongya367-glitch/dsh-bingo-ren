# Bingo 预览与截图

这个目录只用于本地预览、截图与客户端构建，**不会进入 npm 包**（`files` 白名单不含 `preview`）。

## 打开预览

直接双击或在浏览器打开 `preview/index.html`。页面用 `window.fetch` 拦截 `/bingo/*`，返回 mock 状态；不需要宿主插件。

| URL 参数 | 场景 |
| --- | --- |
| `?scene=button`（默认） | 左下角 Bingo 胶囊 |
| `?scene=panel` | 自动打开面板（状态：可重启、上次重启成功） |
| `?scene=panel-pending` | 面板 + 新插件高亮块（不自动弹层） |
| `?scene=pending` | 检测到新插件，居中弹层 |
| `?scene=restarting` | 重启等待态 |
| `?scene=web` | Web 降级态（刷新页面） |
| `&theme=dark` | 深色主题 |
| `&dev=1` | 右下角场景切换条 |

也可以用 `node preview/build.mjs` 从 `preview/src/bingo-client.{js,css}` 重新生成 `client/` 下的压缩产物。生成时做三类保守压缩：去空白、类名/变量短名、状态字段短名；源码保留在 `preview/src`，构建后 JS+CSS 约 35 KB（预算 < 38 KB，含拖拽/吸附）。

## 关于 assets/screenshot-*.png

当前会话的沙箱禁止命名管道，Edge/Chrome 的 Mojo IPC 无法启动（`platform_channel.cc ... 拒绝访问`、crashpad `OpenProcess` 拒绝），所以 **assets 下的按钮/面板/新插件三张主图是离线设计渲染，不是浏览器截图**（另附一张可选深色面板图）：

- 脚本：`preview/render-screenshots.mjs`，用 SVG 绘制与 `preview/index.html` 相同的页面/组件尺寸，再用 sharp（DSH 自带）栅格化为 1440×900 PNG（含 `screenshot-panel-dark.png` 深色面板）。
- 图片只用于设计评审和占位；**真实浏览器截图请在沙箱外的机器上用下面的 Edge 命令重拍**。
- 若在正常机器上已安装 sharp：`node preview/render-screenshots.mjs` 会直接重新生成离线图（脚本已自动执行 main；可用 `BINGO_SHARP` 指定 sharp 绝对路径）。DSH 自带 sharp 时可这样跑：`$env:ELECTRON_RUN_AS_NODE=1; $env:BINGO_SHARP="<DSH>/resources/app.asar/dsh/node_modules/sharp"; & "<DSH>/DeepSeek Harness.exe" --expose-internals preview/render-screenshots.mjs`。

## 在沙箱外重拍真实截图（Edge，1440×900）

PowerShell：

```powershell
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$root = "C:\Users\31461\Desktop\Bingo"
$profile = Join-Path $env:TEMP "bingo-edge-profile"
$scenes = @(
  @{ scene = "button";  file = "screenshot-button.png" },
  @{ scene = "panel";   file = "screenshot-panel.png" },
  @{ scene = "pending"; file = "screenshot-new-plugin.png" },
  @{ scene = "panel&theme=dark"; file = "screenshot-panel-dark.png" }
)
foreach ($item in $scenes) {
  & $edge --headless=new --disable-gpu --hide-scrollbars --window-size=1440,900 `
    --user-data-dir=$profile --allow-file-access-from-files `
    --screenshot="$root\assets\$($item.file)" `
    "file:///$($root.Replace('\','/'))/preview/index.html?scene=$($item.scene)"
}
```

注意：
- 给 Edge 独立 `--user-data-dir`，避免和用户正在使用的浏览器抢 profile 锁。
- `?scene=panel` 依赖预览页在 `dsh-bingo:ready` 后自动点开面板，等待首帧即可；如需固定等待可加 `--virtual-time-budget=2000`。
- 截图应确认：按钮不被侧栏遮挡、面板完整、弹层居中且背景有 blur；浅色下文字对比度足够。
- 深色复核：把 URL 加 `&theme=dark` 再截一张（上面已包含 `screenshot-panel-dark.png`）。

## Mock 数据说明

预览里出现的 `dsh-whale-widget` / `dsh-plugin-market` / `dsh-theme-paper` 以及版本号均为示例数据，用于覆盖 UI 状态，不代表真实安装结果。真实状态只来自宿主 `GET /bingo/status`。