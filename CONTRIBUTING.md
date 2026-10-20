# 参与 Bingo

Bingo 是 DeepSeek Harness 的插件善后管家。欢迎提问题、报 bug、改进文档或提交代码。

## 报告问题

开 issue 前请先：

1. 在 Harness 里打开 Bingo → **概览 → 生成排查摘要 → 复制摘要**。
2. 核对摘要内容（它不含聊天、配置、本机路径和原始错误文本，但插件清单本身可能透露使用习惯）。
3. 把摘要贴进 issue，并说明你期望发生什么、实际发生了什么。

摘要比截图更容易定位问题。如果涉及界面异常，再补一张截图。

## 开发

需要 Node.js 20+。

```sh
npm test                        # 单元与契约测试
npm run build                   # 由 preview/src 重建 client/
node test/integration/mock-host.mjs   # HTTP 集成
npm run test:smoke              # 真实 profile 只读冒烟
```

可选的真实浏览器检查：

```sh
node preview/serve.mjs          # 静态预览服务
node preview/check.mjs          # 15 个场景的 headless 检查
```

预览与真实浏览器检查都使用模拟数据与独立浏览器 profile，不会操作正在运行的 Harness。

## 提交代码

- 功能改动请带测试；`npm test` 必须全绿。
- 改动 `preview/src/` 后请执行 `npm run build`，并把生成的 `client/` 一起提交。
- 不引入运行时依赖。零依赖是刻意的取舍。
- 涉及文件写入的改动，请复用 `lib/local-state.js` 的 PID 写锁与路径约束，不要自己拼路径。
- 不要对用户运行中的 profile 做写入验证；用临时目录或独立 profile。

## 文档

- `SPEC.md`：实现细节、配置项与兼容性。
- `PUBLISH.md`：发布流程与已发布版本的核验记录。
- `preview/README.md`：如何重拍 README 截图。

## 许可

提交即表示同意以 [MIT License](LICENSE) 授权。
