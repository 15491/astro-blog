---
title: "Git 工作流与团队规范"
description: "从 Commit Message 规范、分支策略到 pre-commit hooks 与自动化发布，系统梳理前端团队的 Git 协作规范与工程实践"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: ""
tags: ["Git", "工程实践", "团队协作", "husky", "commitlint"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Git 工作流与团队规范

Git 工作流的价值不在于"用了哪套规范"，而在于**团队所有人遵守同一套约定**。不一致的 commit 风格、随意命名的分支、没有 review 的合并——这些才是真正让仓库历史变成垃圾场的原因。

本文梳理前端团队最实用的 Git 规范体系，从 commit 到发布完整覆盖。

---

## 一、Commit Message 规范

### Conventional Commits

Conventional Commits 是目前使用最广泛的 commit 规范，格式如下：

```
<type>(<scope>): <subject>

[body]

[footer]
```

`type` 表示本次改动的性质：

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响逻辑） |
| `refactor` | 重构（不是新功能也不是 bug 修复） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建工具、依赖更新等杂项 |
| `revert` | 回滚 |

### 反例与正例

```bash
# ❌ 含糊不清，看不出改了什么
git commit -m "fix bug"
git commit -m "update"
git commit -m "修改样式"
git commit -m "wip"

# ✅ 类型明确，scope 可选，subject 说清楚做了什么
git commit -m "fix(auth): 修复 token 过期后未跳转登录页的问题"
git commit -m "feat(order): 新增订单批量导出功能"
git commit -m "refactor(utils): 将日期格式化函数提取到 dateUtils 模块"
git commit -m "chore: 升级 vite 到 5.2.0"
```

### subject 的写法

- 用中文或英文均可，团队统一即可
- 不超过 72 个字符
- 动词开头（不要写成名词短语）
- 不加句号

```bash
# ❌ 名词短语，读起来不知道做了什么操作
git commit -m "feat: 用户权限模块"

# ✅ 动词开头，明确操作
git commit -m "feat: 新增用户权限模块，支持按钮级别控制"
```

### Breaking Change

破坏性变更在 footer 里用 `BREAKING CHANGE:` 标注，或在 type 后加 `!`：

```bash
git commit -m "feat(api)!: 移除 getUserInfo 接口，改用 getProfile"

# 或者在 footer 里说明
git commit -m "refactor(store): 重构 Pinia store 结构

BREAKING CHANGE: store 模块命名从 useUserStore 改为 useAuthStore，
调用方需同步更新 import 路径"
```

---

## 二、分支策略

### Git Flow vs Trunk-Based

两种主流策略的核心区别：

| 维度 | Git Flow | Trunk-Based |
|------|---------|-------------|
| 主干分支 | `main` + `develop` | 只有 `main` |
| 发布方式 | release 分支 → main | 直接从 main 发布 |
| 功能开发 | feature 分支，生命周期较长 | 短生命周期分支（1-2天） |
| 适合场景 | 有明确版本周期的产品 | 持续交付、CI/CD 完善的团队 |
| 复杂度 | 较高，分支合并频繁 | 较低，但对测试覆盖要求高 |

### 推荐：简化 Git Flow

大多数前端团队介于两者之间，用简化版 Git Flow 最实用：

```
main          ──────●──────────────●──── (只接受 PR 合并，保护分支)
                    ↑              ↑
release/1.2.0 ──────●              |
                    ↑              |
develop       ──●───●───●──────────●──── (日常开发基线)
                ↑       ↑
feature/xxx   ──●       |
                        |
hotfix/yyy    ──────────●
```

**分支命名约定：**

```bash
# 功能分支
feature/user-login
feature/order-export

# 修复分支
fix/token-refresh-bug
hotfix/payment-crash   # 紧急线上修复

# 发布分支
release/1.3.0

# 实验性分支
experiment/new-chart-lib
```

### 分支保护规则（GitHub / GitLab 配置）

`main` 和 `develop` 分支必须开启保护：
- ✅ 禁止直接 push，必须通过 PR
- ✅ 合并前必须通过 CI 检查
- ✅ 至少 1 人 approve
- ✅ 禁止 force push

---

## 三、pre-commit Hooks

Hooks 的作用是在 commit 之前自动执行检查，拦截不符合规范的代码，**让问题在本地就被发现**，而不是等到 CI 流水线才报错。

### 工具链

```
husky        → 管理 Git hooks 生命周期
lint-staged  → 只对 staged 文件执行检查（避免全量扫描太慢）
commitlint   → 验证 commit message 格式
```

### 安装配置

```bash
npm install -D husky lint-staged @commitlint/cli @commitlint/config-conventional
npx husky init
```

**`commitlint.config.js`：**

```js title="commitlint.config.js"
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'revert'],
    ],
    'subject-max-length': [2, 'always', 72],
    'subject-empty': [2, 'never'],
  },
}
```

**`.husky/commit-msg`（验证 commit message）：**

```bash
npx --no -- commitlint --edit $1
```

**`.husky/pre-commit`（提交前跑 lint）：**

```bash
npx lint-staged
```

**`package.json` 中配置 lint-staged：**

```json title="package.json"
{
  "lint-staged": {
    "*.{ts,tsx,vue}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{css,scss}": [
      "prettier --write"
    ],
    "*.md": [
      "prettier --write"
    ]
  }
}
```

### 验证效果

```bash
# ❌ commit message 不符合规范，被 commitlint 拦截
git commit -m "修改了一些东西"
# ✖ subject may not be empty [subject-empty]
# ✖ type may not be empty [type-empty]

# ✅ 符合规范，顺利通过
git commit -m "fix(login): 修复密码输入框回车键未触发登录的问题"
```

---

## 四、PR / Code Review 规范

### PR 的粒度

```
# ❌ 一个 PR 包含多个独立功能，review 困难
PR: "用户模块重构 + 新增订单导出 + 修复若干 bug"

# ✅ 一个 PR 只做一件事，描述清楚背景和改动
PR: "feat: 新增订单批量导出功能"
```

**PR 描述模板：**

```markdown
## 背景

为什么需要这个改动？（需求来源 / bug 现象）

## 改动内容

- 新增 `ExportButton` 组件，支持 CSV / Excel 格式
- 封装 `useExport` hook 处理异步导出逻辑
- 更新 `OrderList` 页面接入导出能力

## 测试点

- [ ] 点击导出按钮，能正确下载 CSV 文件
- [ ] 超过 10000 条数据时，触发分片下载
- [ ] 导出中途取消，loading 状态正确还原

## 相关链接

- 需求文档：...
- 关联 issue：#123
```

### Review 原则

**reviewer：**

```
# ❌ 无效评论：不说为什么，也不给方向
"这里写得不好"
"建议优化"

# ✅ 有效评论：指出问题 + 给出理由或建议
"这里每次渲染都会重新创建函数，建议用 useCallback 包一下，
避免子组件不必要的重渲染"
```

评论分级，让 author 知道优先级：
- `[blocking]` 必须改，影响正确性或安全性
- `[suggestion]` 建议改，但不强制
- `[nit]` 小细节，author 自行判断

---

## 五、版本发布与 CHANGELOG

### 语义化版本（SemVer）

```
MAJOR.MINOR.PATCH

MAJOR：破坏性变更（breaking change）
MINOR：向后兼容的新功能（feat）
PATCH：向后兼容的 bug 修复（fix）

1.0.0 → 1.0.1  修复了一个 bug
1.0.1 → 1.1.0  新增了一个功能
1.1.0 → 2.0.0  接口有破坏性改动
```

### 用 release-it 自动化发布

```bash
npm install -D release-it @release-it/conventional-changelog
```

```json title=".release-it.json"
{
  "git": {
    "commitMessage": "chore: release v${version}",
    "tagName": "v${version}"
  },
  "github": {
    "release": true
  },
  "plugins": {
    "@release-it/conventional-changelog": {
      "preset": "conventionalcommits",
      "infile": "CHANGELOG.md"
    }
  }
}
```

执行发布：

```bash
# 自动识别是 patch / minor / major
npx release-it

# 或者指定版本类型
npx release-it minor
```

它会自动做以下事情：
1. 根据 commit 历史生成 CHANGELOG
2. 更新 `package.json` 中的 version
3. 创建 git tag
4. 推送到远端并创建 GitHub Release

---

## 总结：团队规范速查

| 场景 | 规范要点 |
|------|---------|
| 写 commit | `type(scope): subject`，动词开头，不超 72 字 |
| 命名分支 | `feature/` `fix/` `hotfix/` `release/` 前缀 |
| 保护分支 | main/develop 禁止直接 push，PR 必须 CI 通过 |
| pre-commit | husky + lint-staged + commitlint 三件套 |
| 发 PR | 一件事一个 PR，描述清楚背景和测试点 |
| 版本发布 | SemVer + release-it 自动生成 CHANGELOG |
