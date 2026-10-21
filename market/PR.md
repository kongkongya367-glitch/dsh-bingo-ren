# 社区目录：已合并

**PR #8273 已合并。** https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/8273

| 项目 | 结果 |
|---|---|
| 提交时间 | 2026-10-20T08:54Z |
| 合并时间 | 2026-10-20T17:57Z |
| 合并者 | `fkysly` |
| 评审评论 | 0（直接合并，未要求改动） |
| 改动 | 1 个文件，+6 行 |

## 合并后核验

| 检查 | 结果 |
|---|---|
| `data/plugins/kongkongya367-glitch__dsh-bingo-ren.yml` 在 main | ✅ 675 字节，sha `a3b60a2c` |
| README 收录行 | ✅ 第 608 行，位于 `### UI Enhancements` 分类下 |
| 描述与实际一致 | ✅ 与提交内容逐字相同，未被维护者修改 |

README 中的收录行：

```text
- [kongkongya367-glitch/dsh-bingo-ren](...) - Adds a draggable restart button and a plugin
  panel to the DeepSeek Harness desktop app: it prompts when the profile plugin list changes,
  records additions and removals per profile, tracks trials, reports host startup state,
  and offers rollback, minimal boot and recoverable cleanup.
```

## 现在可以用的徽章

```markdown
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
```

## 提交时核对过的规则

| 要求 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` + 根目录 `cordis.patch.yml` | ✅ |
| 真实可用代码（非占位/纯 README） | ✅ 12 个宿主模块 + 128 项测试 |
| 仓库创建满 1 天 | ✅ 27 小时 |
| 有 `dsh-plugin` topic | ✅ |
| 描述属实、无营销词 | ✅ 逐条对应代码行为 |
| 描述含 `: ` 时加引号 | ✅ 中英均用双引号 |

## 经验

- 一个插件一个文件的规则让 PR 不会互相冲突，提 PR 时只加一个文件即可。
- CI 只校验形式；这次维护者没写评审意见就直接合并，说明「真实代码 + 描述属实」这两条足够。
- 分类 `ui` 被接受，未做调整。
