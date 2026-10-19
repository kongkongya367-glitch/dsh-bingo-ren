# 发布 Bingo

当前维护版本：`0.5.0`。npm 包为 [`dsh-bingo-ren`](https://www.npmjs.com/package/dsh-bingo-ren)，GitHub 附件见 [Releases](https://github.com/kongkongya367-glitch/dsh-bingo-ren/releases)。源码版本不等于已发布版本，公开状态以注册表及 Release 为准。社区插件目录尚未提交。

## 发布前

```sh
npm run build
npm test
node test/integration/mock-host.mjs
node test/browser-activity.mjs
npm run test:smoke
npm pack --dry-run
```

Windows 可额外运行 `scripts/pack-check.ps1` 检查包内容。确保包内没有个人路径、凭据、真实配置、测试数据或内部记录。

为代码修改递增版本号，并更新 `CHANGELOG.md`。已公开的版本与标签保持不变。

## npm

```sh
npm whoami
mkdir dist
npm pack --pack-destination dist
npm publish ./dist/dsh-bingo-ren-0.5.0.tgz --access public --auth-type=web
npm view dsh-bingo-ren version dist.tarball
```

账号需满足 npm 的双因素认证要求。按官方浏览器或终端提示验证；不要把密码、令牌、验证码或恢复码写进仓库。

## GitHub Release

提交并推送经过验证的修改，创建与包版本一致的标签和 Release，附上同一份 `.tgz`。核对安装包版本及校验值后再更新市场条目中的 `tarball` 链接。

## 社区目录

材料位于 `market/`。按目标仓库当前的贡献规则添加一个插件 YAML 条目，并检查仓库年龄、topic、manifest 和截图声明。PR 合并后才能称为已收录。

安装测试应使用独立 profile，不操作运行中的 desktop profile。

## 发布结果核验

仅在注册表返回目标版本、并下载比对安装包后记录 npm 成功。浏览器出现 404 不能单独证明发布成功或失败；应核对终端结果和注册表。GitHub 与 npm 使用同一份 `.tgz`，公开下载后核对 SHA-256。
