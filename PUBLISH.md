# 发布 Bingo

当前维护版本：`0.2.0`。npm 包为 [`dsh-bingo-ren`](https://www.npmjs.com/package/dsh-bingo-ren)，GitHub 附件见 [Releases](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases)。社区插件目录尚未提交。

## 发布前

```sh
npm run build
npm test
node test/integration/mock-host.mjs
npm pack --dry-run
```

Windows 可额外运行 `scripts/pack-check.ps1` 检查包内容。确保包内没有个人路径、凭据、真实配置、测试数据或内部记录。

为代码修改递增版本号，并更新 `CHANGELOG.md`。已公开的版本与标签保持不变。

## npm

```sh
npm whoami
npm publish --access public
npm view dsh-bingo-ren version dist.tarball
```

账号需满足 npm 的双因素认证要求。按官方浏览器或终端提示验证；不要把密码、令牌、验证码或恢复码写进仓库。

## GitHub Release

提交并推送经过验证的修改，创建与包版本一致的标签和 Release，附上同一份 `.tgz`。核对安装包版本及校验值后再更新市场条目中的 `tarball` 链接。

## 社区目录

材料位于 `market/`。按目标仓库当前的贡献规则添加一个插件 YAML 条目，并检查仓库年龄、topic、manifest 和截图声明。PR 合并后才能称为已收录。

安装测试应使用独立 profile，不操作运行中的 desktop profile。

## 0.2.0 发布进度

GitHub 源码、标签与 Release 安装包已发布并校验。npm 发布因浏览器验证会话过期而中断，当前 latest 仍为 0.1.3。重新完成 npm 身份验证、核对 registry 下载包后，再移除 README 中的待发布提示。
