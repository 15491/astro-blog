---
title: "TypeScript 工程实践"
description: "从 tsconfig 核心字段到路径别名、类型声明文件与项目引用，系统梳理 TypeScript 在前端工程中的配置实践与常见问题解决"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: ""
tags: ["TypeScript", "tsconfig", "工程实践", "类型系统"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# TypeScript 工程实践

TypeScript 的类型系统有多强大，工程配置就有多容易踩坑。`tsconfig.json` 里几十个字段，`strict` 模式下一堆报错，第三方包没有类型……这些是每个团队刚引入 TS 时必经的痛苦。

本文聚焦**工程配置**，不讲类型体操，讲如何让 TypeScript 在真实项目里稳定运行。

---

## 一、tsconfig 核心字段

### strict 系列：一次开全，别半吊子

```json title="tsconfig.json"
{
  "compilerOptions": {
    "strict": true
  }
}
```

`strict: true` 是以下选项的集合，逐个了解它们的作用：

| 选项 | 作用 |
|------|------|
| `strictNullChecks` | `null` 和 `undefined` 不能赋给其他类型，必须显式处理 |
| `noImplicitAny` | 禁止隐式 `any`，参数和变量必须有类型 |
| `strictFunctionTypes` | 函数参数类型逆变检查 |
| `strictPropertyInitialization` | 类属性必须在构造函数里初始化 |
| `noImplicitThis` | `this` 类型必须显式声明 |

```ts
// ❌ strict 模式下报错
function greet(name) {  // noImplicitAny：name 隐式为 any
  return `Hello, ${name}`
}

const user = getUser()
console.log(user.name)  // strictNullChecks：user 可能为 null

// ✅ 修正后
function greet(name: string) {
  return `Hello, ${name}`
}

const user = getUser()
console.log(user?.name)  // 可选链处理 null 情况
```

:::tip[已有项目迁移]
老项目开 `strict` 会有大量报错，可以先开 `strictNullChecks` 单项，逐步修复后再开全量 `strict`。
:::

### module 与 target：输出格式

```json
{
  "compilerOptions": {
    "target": "ES2020",     // 编译产物的 JS 版本
    "module": "ESNext",     // 模块格式
    "moduleResolution": "Bundler"  // Vite/webpack 项目用这个
  }
}
```

**`moduleResolution` 的选择：**

| 值 | 适用场景 |
|----|---------|
| `Node` | Node.js 传统项目 |
| `Bundler` | Vite / webpack 项目（推荐） |
| `NodeNext` | 原生 ESM Node.js 项目 |

`Bundler` 模式更宽松，允许省略扩展名，与打包工具的行为一致：

```ts
// moduleResolution: Node 下必须写扩展名
import { utils } from './utils.js'

// moduleResolution: Bundler 下可以省略
import { utils } from './utils'
```

### 其他重要字段

```json title="tsconfig.json"
{
  "compilerOptions": {
    "baseUrl": ".",               // 路径解析的根目录
    "paths": { "@/*": ["src/*"] }, // 路径别名
    "skipLibCheck": true,         // 跳过 node_modules 里的类型检查（提速）
    "noUnusedLocals": true,       // 未使用的变量报错
    "noUnusedParameters": true,   // 未使用的参数报错
    "exactOptionalPropertyTypes": true, // 严格区分 undefined 和可选属性
    "lib": ["ES2020", "DOM", "DOM.Iterable"]  // 内置类型库
  }
}
```

---

## 二、路径别名配置

路径别名让 `import` 不再满屏 `../../..`，但需要在两个地方同步配置：TypeScript（用于类型解析）和打包工具（用于运行时解析）。

### TypeScript 侧

```json title="tsconfig.json"
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@utils/*": ["src/utils/*"]
    }
  }
}
```

### Vite 侧

```ts title="vite.config.ts"
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
})
```

### 用 vite-tsconfig-paths 避免重复配置

```bash
npm install -D vite-tsconfig-paths
```

```ts title="vite.config.ts"
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],  // 自动读取 tsconfig paths，不需要手动写 alias
})
```

---

## 三、类型声明文件

### 为第三方包补充类型

部分老库没有 TS 类型，或者 `@types/xxx` 包不够用，自己写 `.d.ts`：

```ts title="src/types/legacy-lib.d.ts"
// 为没有类型的第三方库声明模块
declare module 'some-legacy-lib' {
  export function init(config: { key: string }): void
  export function track(event: string, data?: object): void
}
```

### 扩展已有类型

```ts title="src/types/augment.d.ts"
// 扩展 Window 对象（挂全局变量时）
interface Window {
  __APP_VERSION__: string
  dataLayer: object[]
}

// 扩展 Vue 组件实例（挂全局属性时）
import 'vue'
declare module 'vue' {
  interface ComponentCustomProperties {
    $toast: (message: string) => void
    $http: AxiosInstance
  }
}
```

### 环境变量类型

```ts title="src/types/env.d.ts"
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_APP_TITLE: string
  readonly VITE_ENABLE_MOCK: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

配置后，`import.meta.env.VITE_API_BASE_URL` 就有类型提示和拼写检查了。

### `.d.ts` 的放置规则

```
src/
  types/
    env.d.ts          # 环境变量
    augment.d.ts      # 类型扩展
    legacy-lib.d.ts   # 第三方库补充
    api.d.ts          # 接口响应类型（如果不拆模块）
```

确保 `tsconfig.json` 的 `include` 包含这个目录：

```json
{
  "include": ["src/**/*.ts", "src/**/*.d.ts", "src/**/*.vue"]
}
```

---

## 四、项目引用（Monorepo 场景）

Monorepo 里多个包互相依赖时，用 Project References 让 TS 知道包之间的依赖关系，实现增量编译：

```
monorepo/
  packages/
    utils/
      tsconfig.json
    components/
      tsconfig.json   ← 引用 utils
    app/
      tsconfig.json   ← 引用 utils 和 components
  tsconfig.json       ← 根配置
```

```json title="packages/components/tsconfig.json"
{
  "compilerOptions": {
    "composite": true,          // 必须开启，允许被其他项目引用
    "declarationDir": "dist",
    "declaration": true
  },
  "references": [
    { "path": "../utils" }      // 声明依赖 utils 包
  ]
}
```

```json title="tsconfig.json（根）"
{
  "references": [
    { "path": "packages/utils" },
    { "path": "packages/components" },
    { "path": "packages/app" }
  ]
}
```

增量构建：

```bash
# --build 模式：只重新编译有变化的包
tsc --build
```

---

## 五、常见报错与解决

### `Cannot find module` 或路径别名不生效

```
// 报错：Cannot find module '@/utils/format'
```

原因：`tsconfig.json` 配了 `paths`，但打包工具没有对应的 `alias`。检查两边是否都配置了，或者改用 `vite-tsconfig-paths` 统一管理。

### `Object is possibly 'null'`

```ts
// ❌ 报错
const el = document.getElementById('app')
el.style.color = 'red'  // el 可能为 null

// ✅ 方案一：非空断言（确定不为 null 时）
el!.style.color = 'red'

// ✅ 方案二：可选链（更安全）
el?.style && (el.style.color = 'red')

// ✅ 方案三：类型收窄
if (el) {
  el.style.color = 'red'
}
```

### `Type 'string' is not assignable to type`

```ts
// ❌ 字面量类型收窄问题
const direction = 'left'  // 推断为 string
moveSlider(direction)     // 参数要求 'left' | 'right'，string 不够窄

// ✅ 方案一：as const
const direction = 'left' as const  // 推断为 'left'

// ✅ 方案二：显式类型注解
const direction: 'left' | 'right' = 'left'
```

### 第三方库类型缺失

```bash
# 先查有没有官方类型包
npm install -D @types/lodash

# 没有就自己写 .d.ts（见第三节）
```

### `strictPropertyInitialization` 报错

```ts
// ❌ 报错：属性 name 在构造函数里未初始化
class User {
  name: string  // error
}

// ✅ 方案一：构造函数初始化
class User {
  name: string
  constructor(name: string) {
    this.name = name
  }
}

// ✅ 方案二：明确标记为可选或给默认值
class User {
  name: string = ''
  // 或
  name?: string
}

// ✅ 方案三：非空断言（数据会在别处初始化，如依赖注入）
class User {
  name!: string
}
```

---

## tsconfig 字段速查

| 字段 | 推荐值 | 说明 |
|------|--------|------|
| `strict` | `true` | 开启全量严格检查 |
| `target` | `ES2020` | 编译目标，现代浏览器可用 ES2020 |
| `module` | `ESNext` | 输出 ESM 格式 |
| `moduleResolution` | `Bundler` | Vite/webpack 项目 |
| `skipLibCheck` | `true` | 跳过 node_modules 类型检查，提速 |
| `noUnusedLocals` | `true` | 未使用变量报错 |
| `noUnusedParameters` | `true` | 未使用参数报错 |
| `baseUrl` | `"."` | 配合 paths 使用 |
| `paths` | 按需 | 路径别名 |
| `lib` | `["ES2020","DOM"]` | 内置类型库 |
| `composite` | `true`（被引用包） | 项目引用必须 |
| `declaration` | `true`（库项目） | 生成 .d.ts 文件 |
