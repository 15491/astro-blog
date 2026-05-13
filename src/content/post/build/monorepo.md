---
title: "Monorepo 工程实践"
description: "Monorepo 的核心概念与工具选型，基于 pnpm workspace + Turborepo 搭建多包项目，包含依赖管理、构建缓存、共享配置等实践"
publishDate: "2026-05-13T21:56:37.282Z"
updatedDate: ""
tags: ["monorepo", "pnpm", "turborepo", "工程化"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Monorepo 工程实践

## 什么是 Monorepo

**Monorepo**（Monolithic Repository）是将多个项目/包放在同一个 Git 仓库中管理的工程方式，与之相对的是 **Polyrepo**（每个项目独立一个仓库）。

```
Polyrepo                      Monorepo
─────────────────             ─────────────────────────
repo-web/                     my-project/
repo-app/           →         ├── apps/
repo-shared/                  │   ├── web/
repo-utils/                   │   └── app/
                               └── packages/
                                   ├── shared/
                                   └── utils/
```

### Monorepo vs Polyrepo

| | Monorepo | Polyrepo |
| --- | --- | --- |
| 代码共享 | 直接引用，无需发布 | 需发布 npm 包，版本管理繁琐 |
| 依赖管理 | 统一安装，避免版本冲突 | 各自维护，同一依赖可能多个版本 |
| 原子提交 | 跨包修改一次提交 | 需多仓库协调，难以保证一致性 |
| CI/CD | 需要智能识别变更范围 | 各自独立，配置简单 |
| 仓库体积 | 随项目增多而增大 | 各自独立，体积可控 |
| 适用场景 | 关联性强的多包项目 | 完全独立的项目 |

---

## 工具选型

Monorepo 通常需要两层工具配合：

| 职责 | 工具选项 |
| --- | --- |
| **包管理 / workspace** | pnpm、npm、yarn |
| **构建编排 / 任务缓存** | Turborepo、Nx、Rush |

目前最主流的组合是 **pnpm workspace + Turborepo**：pnpm 解决依赖安装和包引用，Turborepo 解决多包构建的任务编排和缓存加速。

---

## pnpm Workspace

pnpm 原生支持 workspace，是 Monorepo 中使用最广泛的包管理器。

### 初始化项目

```bash
mkdir my-monorepo && cd my-monorepo
pnpm init
```

### 配置 workspace

在根目录创建 `pnpm-workspace.yaml`，声明哪些目录是 workspace 包：

```yaml title="pnpm-workspace.yaml"
packages:
  - 'apps/*'
  - 'packages/*'
```

### 目录结构

```
my-monorepo/
├── pnpm-workspace.yaml
├── package.json
├── apps/
│   ├── web/          # 前端应用
│   │   └── package.json
│   └── server/       # 后端服务
│       └── package.json
└── packages/
    ├── ui/           # 共享组件库
    │   └── package.json
    ├── utils/        # 共享工具函数
    │   └── package.json
    └── tsconfig/     # 共享 TypeScript 配置
        └── package.json
```

### 根目录 package.json

```json title="package.json"
{
  "name": "my-monorepo",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  }
}
```

:::important[根包必须设置 private: true]
根目录的 `package.json` 必须加 `"private": true`，防止根包被意外发布到 npm。
:::

---

## 依赖管理

### 安装依赖

```bash
# 在根目录安装（所有包可用的开发工具，如 eslint、typescript）
pnpm add -D typescript -w

# 在指定包中安装
pnpm add react --filter @my/web

# 在所有包中安装
pnpm add lodash-es --filter='./packages/*'
```

### 包之间互相引用

workspace 内的包可以通过 `workspace:*` 协议直接引用，无需发布到 npm：

```json title="apps/web/package.json"
{
  "name": "@my/web",
  "dependencies": {
    "@my/ui": "workspace:*",
    "@my/utils": "workspace:*"
  }
}
```

:::note[workspace:\* 的含义]
`workspace:*` 表示使用 workspace 中当前版本，pnpm 会在 `node_modules` 中创建软链接指向本地包目录。发布时 pnpm 会自动将其替换为实际版本号。
:::

安装后，`apps/web/node_modules/@my/ui` 会是一个软链接，修改 `packages/ui` 的代码会立即生效，无需重新安装。

### 执行指定包的命令

```bash
# 在指定包中执行命令
pnpm --filter @my/web dev
pnpm --filter @my/ui build

# 在所有包中执行
pnpm -r build

# 在匹配的包中执行
pnpm --filter './packages/*' build
```

---

## 共享配置

### 共享 TypeScript 配置

将基础 tsconfig 提取成独立包，各项目按需继承：

```json title="packages/tsconfig/base.json"
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true
  }
}
```

```json title="packages/tsconfig/package.json"
{
  "name": "@my/tsconfig",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./base": "./base.json",
    "./vite": "./vite.json",
    "./nextjs": "./nextjs.json"
  }
}
```

各包继承：

```json title="apps/web/tsconfig.json"
{
  "extends": "@my/tsconfig/base",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

### 共享 ESLint 配置

```js title="packages/eslint-config/index.js"
module.exports = {
  extends: ['eslint:recommended'],
  rules: {
    'no-console': 'warn',
  },
}
```

```json title="packages/eslint-config/package.json"
{
  "name": "@my/eslint-config",
  "version": "0.0.0",
  "private": true,
  "main": "index.js"
}
```

```json title="apps/web/.eslintrc.json"
{
  "extends": ["@my/eslint-config"]
}
```

---

## Turborepo

[Turborepo](https://turbo.build/) 是专为 Monorepo 设计的高性能构建系统，核心优势是**增量构建**和**任务缓存**。

### 安装

```bash
pnpm add -D turbo -w
```

### 配置文件

```json title="turbo.json"
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test": {
      "outputs": ["coverage/**"]
    }
  }
}
```

### dependsOn 依赖关系

`dependsOn` 控制任务的执行顺序：

| 写法 | 含义 |
| --- | --- |
| `"^build"` | 先执行所有**依赖包**的 `build`，再执行当前包的 `build` |
| `"build"` | 先执行当前包自己的 `build`，再执行当前任务 |
| `[]` | 无依赖，可并行执行 |

:::tip[^ 前缀的含义]
`^` 表示「依赖的依赖」。`apps/web` 依赖 `packages/ui`，配置 `"^build"` 后，运行 `turbo build` 时会先构建 `packages/ui`，再构建 `apps/web`。Turborepo 会自动分析依赖图，确定正确的执行顺序。
:::

### 构建缓存

Turborepo 会对每个任务的输入（源文件、依赖、环境变量）计算哈希值，如果输入没变，直接复用上次的输出，跳过执行。

```bash
# 第一次构建（无缓存）
turbo build
# >>> Finished! (15.2s)

# 再次构建（命中缓存）
turbo build
# >>> FULL TURBO (0.1s)
```

缓存的输入默认包含：
- 包内所有文件（可通过 `inputs` 配置精确指定）
- 依赖的 `package.json` 中的版本号
- 环境变量（需在 `env` 中声明才纳入）

```json title="turbo.json"
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "inputs": ["src/**", "package.json"],
      "env": ["NODE_ENV", "VITE_API_URL"]
    }
  }
}
```

:::caution[outputs 必须准确配置]
`outputs` 决定哪些文件会被缓存。如果漏配（如忘记加 `.next/**`），缓存命中时这些文件不会被恢复，导致构建输出不完整。
:::

### 远程缓存

本地缓存只对本机有效，远程缓存可以让团队成员和 CI 共享构建结果：

```bash
# 登录 Vercel（官方远程缓存服务，免费）
npx turbo login

# 链接到远程缓存
npx turbo link
```

也可以自托管远程缓存服务（开源方案：[ducktors/turborepo-remote-cache](https://github.com/ducktors/turborepo-remote-cache)）：

```json title="turbo.json"
{
  "remoteCache": {
    "apiUrl": "https://your-cache-server.com"
  }
}
```

配置后，CI 第一次跑完的缓存，本地开发者可以直接复用，大幅缩短等待时间。

### 过滤执行范围

```bash
# 只构建指定包及其依赖
turbo build --filter=@my/web

# 只执行受变更影响的包（基于 git diff）
turbo build --filter='[HEAD^1]'

# 组合：只执行 apps 下发生变更的包
turbo build --filter='./apps/...[HEAD^1]'
```

---

## 发布工作流

### changesets — 版本管理与发布

[Changesets](https://github.com/changesets/changesets) 是 Monorepo 中最常用的版本管理工具：

```bash
pnpm add -D @changesets/cli -w
pnpm changeset init
```

工作流：

```bash
# 1. 开发完成后，声明变更
pnpm changeset
# 交互式选择影响的包和版本类型（patch/minor/major），填写变更描述

# 2. 合并到主分支后，统一升版本
pnpm changeset version
# 自动根据 .changeset/ 目录下的文件更新各包版本号和 CHANGELOG

# 3. 发布到 npm
pnpm changeset publish
```

:::note[changeset 文件不要删除]
`pnpm changeset` 生成的 `.changeset/*.md` 文件需要提交到 git，它们是版本升级的依据。`pnpm changeset version` 执行后才会自动删除。
:::

---

## 实践示例：共享组件库

以 `packages/ui` 为例，演示一个完整的共享包设置：

```json title="packages/ui/package.json"
{
  "name": "@my/ui",
  "version": "0.0.0",
  "private": true,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch"
  },
  "devDependencies": {
    "@my/tsconfig": "workspace:*",
    "vite": "^5.0.0",
    "vite-plugin-dts": "^3.0.0"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  }
}
```

:::tip[共享包用 peerDependencies]
像 `react` 这样的框架应该放在 `peerDependencies` 而不是 `dependencies`，避免应用和包各自安装一份 React，导致 Hook 规则报错（两个 React 实例）。
:::

```ts title="packages/ui/src/index.ts"
export { Button } from './Button'
export { Input } from './Input'
export type { ButtonProps, InputProps } from './types'
```

应用中直接引用：

```ts title="apps/web/src/App.tsx"
import { Button } from '@my/ui'
```

由于 `@my/ui` 是软链接，开发时修改组件代码后（配合 `vite build --watch`），应用无需重启即可生效。

---

## 常见问题

### 某个包的依赖提升到了根目录

pnpm 默认会将相同版本的依赖提升到根目录的 `node_modules`，减少磁盘占用。如果某个包需要独立安装某个依赖版本，在该包的 `package.json` 中显式声明即可。

### 循环依赖

`packages/a` 依赖 `packages/b`，`packages/b` 又依赖 `packages/a`，会导致构建死锁。可以用 `turbo run build --graph` 可视化依赖图来排查：

```bash
turbo run build --graph
# 输出 Graphviz DOT 格式的依赖图，可粘贴到 https://dreampuf.github.io/GraphvizOnline/ 可视化
```

### TypeScript 找不到 workspace 包的类型

确保被引用的包已构建（生成了 `dist/` 和 `.d.ts`），或者在 `tsconfig.json` 中配置 `paths` 直接指向源码：

```json title="apps/web/tsconfig.json"
{
  "compilerOptions": {
    "paths": {
      "@my/ui": ["../../packages/ui/src/index.ts"]
    }
  }
}
```

:::tip[开发时指向源码，构建时用产物]
在 `tsconfig.json` 中用 `paths` 指向源码，类型检查和 IDE 跳转会直接定位到源文件。构建时 Vite/webpack 会走 `package.json` 的 `exports` 字段，使用编译后的产物。两者不冲突。
:::

---

## 其他方案：Git Submodule 与 Git Subtree

在 pnpm workspace 流行之前，Git 原生提供了两种多仓库管理方案。现在基本已被 Monorepo 工具链替代，但了解它们有助于理解问题的演进。

### Git Submodule

Submodule 在主仓库中嵌入另一个独立仓库的引用，各自保留独立的 git 历史。

```bash
# 添加子模块
git submodule add https://github.com/org/shared-ui.git packages/ui

# 克隆含子模块的仓库（需额外初始化）
git clone https://github.com/org/my-project.git
git submodule update --init --recursive

# 更新子模块到最新提交
git submodule update --remote
```

主仓库只记录子模块的**某一次 commit hash**，子模块本身的代码变更需要进入子模块目录单独提交再推送。

:::caution[Submodule 使用体验较差]
- clone 后忘记 `--recursive` 会导致子模块目录为空
- 子模块更新后主仓库需要单独提交一次「更新子模块引用」
- 跨模块的原子提交无法实现，多人协作时容易出现引用不同步
:::

### Git Subtree

Subtree 将外部仓库的内容**直接合并进主仓库**，没有额外的引用文件。

```bash
# 添加子树
git subtree add --prefix=packages/ui https://github.com/org/shared-ui.git main --squash

# 拉取子树更新
git subtree pull --prefix=packages/ui https://github.com/org/shared-ui.git main --squash

# 将修改推回子树远端
git subtree push --prefix=packages/ui https://github.com/org/shared-ui.git main
```

相比 Submodule，Subtree 对普通使用者更透明（clone 后直接可用，不需要额外初始化），但推回改动时命令比较繁琐。

### 三种方案对比

| | pnpm Workspace | Git Submodule | Git Subtree |
| --- | --- | --- | --- |
| 代码位置 | 同一仓库 | 独立仓库，主仓库存引用 | 代码合并进主仓库 |
| clone 体验 | 直接可用 | 需要 `--recursive` | 直接可用 |
| 原子提交 | ✓ | ✗ | ✓ |
| 独立版本历史 | ✗ | ✓ | 部分保留 |
| 工具链支持 | 丰富（Turborepo 等） | 原生 git | 原生 git |
| 适用场景 | 关联性强的内部多包项目 | 引用不常变动的第三方库源码 | 需要偶尔同步的外部仓库 |

:::note[现在还用 Submodule 的场景]
Git Submodule 目前主要用于：嵌入不在 npm 上的第三方代码、游戏开发中引用资产仓库、需要严格锁定外部依赖到某一 commit 的场景。日常前端多包项目推荐直接用 pnpm workspace。
:::
