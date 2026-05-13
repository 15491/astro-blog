---
title: "Babel、SWC 与 PostCSS"
description: "前端代码转换工具：Babel 与 SWC 的原理与选型对比、PostCSS 的作用与配置，以及在 Webpack 和 Vite 中的接入方式"
publishDate: "2026-05-14T00:00:00.000Z"
updatedDate: ""
tags: ["babel", "swc", "postcss", "构建工具", "转译"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Babel、SWC 与 PostCSS

构建工具（Webpack/Vite）负责打包，而代码转换工具负责将「你写的代码」变成「浏览器能运行的代码」。本文介绍三个核心工具：处理 JS/TS 的 Babel 和 SWC，以及处理 CSS 的 PostCSS。

---

## Babel

Babel 是最广泛使用的 JavaScript 编译器，主要做两件事：

1. **语法转换**：将新语法（ES2022+、JSX、TypeScript）转换为目标环境支持的旧语法
2. **Polyfill 注入**：为运行时缺少的 API（`Promise`、`Array.prototype.flat` 等）注入垫片

### 工作原理

Babel 的转换过程分三步：

```
源代码
  ↓ Parse（解析）
AST（抽象语法树）
  ↓ Transform（插件遍历 AST 并修改节点）
新的 AST
  ↓ Generate（代码生成）
目标代码
```

### 配置文件

```js title="babel.config.js"
module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: '> 0.5%, not dead', // 目标浏览器范围（browserslist）
        useBuiltIns: 'usage',        // 按需注入 polyfill
        corejs: 3,
      },
    ],
    '@babel/preset-typescript',
    '@babel/preset-react',
  ],
  plugins: [
    '@babel/plugin-transform-class-properties',
  ],
}
```

:::note[babel.config.js vs .babelrc]
- `babel.config.js`：项目级别，影响整个项目包括 `node_modules`，适合单体项目
- `.babelrc`：目录级别，只影响当前目录及子目录，不影响 `node_modules`，适合 monorepo
:::

### preset 与 plugin 的区别

- **plugin**：单一功能的转换规则
- **preset**：一组 plugin 的集合，**从后往前**执行

常用 preset：

| preset | 作用 |
| --- | --- |
| `@babel/preset-env` | 根据目标浏览器自动选择需要的转换和 polyfill |
| `@babel/preset-typescript` | 剥离 TypeScript 类型（不做类型检查） |
| `@babel/preset-react` | 转换 JSX |

:::warning[preset-typescript 不做类型检查]
`@babel/preset-typescript` 只是把类型注解剥掉，不会报类型错误。类型检查需要单独运行 `tsc --noEmit`，通常放在 CI 流程中。
:::

### Polyfill 注入策略

```js title="babel.config.js" {5,6}
module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: '> 1%',
      useBuiltIns: 'usage', // 按需：只注入代码中实际用到的 API
      // useBuiltIns: 'entry', // 全量：根据目标浏览器在入口注入所有需要的 polyfill
      // useBuiltIns: false,   // 不注入，需手动 import
      corejs: 3,
    }],
  ],
}
```

:::tip[推荐用 usage 模式]
`usage` 模式会分析代码，只注入实际用到的 polyfill，产物体积最小。`entry` 模式注入的 polyfill 更完整，适合无法静态分析的场景（如动态代码）。
:::

### 自定义 Babel Plugin

Babel plugin 通过 visitor 模式遍历 AST，对特定节点进行增删改。

**示例：移除所有 `console.log` 调用**

```js title="babel-plugin-remove-console.js"
module.exports = function ({ types: t }) {
  return {
    visitor: {
      CallExpression(path) {
        const { callee } = path.node
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: 'console' }) &&
          t.isIdentifier(callee.property, { name: 'log' })
        ) {
          path.remove()
        }
      },
    },
  }
}
```

```js title="babel.config.js"
module.exports = {
  plugins: ['./babel-plugin-remove-console'],
}
```

:::tip[推荐用 AST Explorer 辅助开发]
在 [astexplorer.net](https://astexplorer.net/) 中粘贴代码，可以实时看到对应的 AST 结构，非常适合用来找到要操作的节点类型。
:::

---

## SWC

[SWC](https://swc.rs/)（Speedy Web Compiler）是用 **Rust** 编写的 JavaScript/TypeScript 编译器，API 与 Babel 高度兼容，但速度快 **20~70 倍**。Next.js 13+、Parcel 2 等都已默认使用。

### Babel vs SWC 对比

| | Babel | SWC |
| --- | --- | --- |
| 实现语言 | JavaScript | Rust |
| 速度 | 基准 | 快 20~70 倍 |
| 生态 | 极其丰富，插件数千 | 较新，核心功能完备 |
| 自定义 plugin | 用 JS 编写，灵活 | 需用 Rust 编写（JS plugin 实验阶段） |
| TypeScript 支持 | 通过 preset 实现 | 原生支持 |
| 配置格式 | `babel.config.js` | `.swcrc`（格式相似） |

### 配置文件

```json title=".swcrc"
{
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "tsx": true,
      "decorators": true
    },
    "transform": {
      "react": {
        "runtime": "automatic"
      }
    },
    "target": "es2015"
  },
  "module": {
    "type": "commonjs"
  },
  "minify": false
}
```

### 在 Webpack 中使用 SWC

```bash
npm install --save-dev swc-loader @swc/core
```

```js title="webpack.config.js" del={3,4} ins={5,6,7,8,9,10,11,12,13}
module.exports = {
  module: {
    rules: [
      { test: /\.[jt]sx?$/, exclude: /node_modules/, use: 'babel-loader' },
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2015' },
          },
        },
      },
    ],
  },
}
```

### 在 Vite 中使用 SWC

Vite 默认已用 esbuild 做转换，React 项目可换用 SWC 官方插件（HMR 更准确）：

```bash
npm install --save-dev @vitejs/plugin-react-swc
```

```ts title="vite.config.ts" del={2,5} ins={3,6}
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
})
```

### 如何选择

:::important[选型建议]
- **新项目**：优先选 SWC，速度快，Next.js/Vite 生态原生支持
- **有复杂自定义 Babel plugin 的项目**：暂时保留 Babel，SWC 的 JS plugin 目前还在实验阶段
- **Vite 项目**：esbuild 已足够快，无需额外配置；React 项目可用 `@vitejs/plugin-react-swc` 获得更好的 HMR 体验
:::

---

## PostCSS

PostCSS 是一个用 JavaScript 转换 CSS 的工具，本身只是一个处理平台，功能完全由**插件**提供。

### 工作原理

```
CSS 源码
  ↓ 解析为 CSS AST
  ↓ 插件遍历 AST 并修改
  ↓ 生成新的 CSS
目标 CSS
```

### 常用插件

| 插件 | 作用 |
| --- | --- |
| `autoprefixer` | 自动添加浏览器厂商前缀（`-webkit-`、`-moz-` 等） |
| `postcss-preset-env` | 将现代 CSS 语法降级（CSS 领域的 `@babel/preset-env`） |
| `cssnano` | 压缩 CSS，移除注释和多余空白 |
| `postcss-modules` | CSS Modules 支持 |
| `postcss-import` | 将 `@import` 内联展开 |
| `tailwindcss` | Tailwind CSS（底层基于 PostCSS） |

### 配置文件

```js title="postcss.config.js"
module.exports = {
  plugins: [
    require('postcss-import'),
    require('tailwindcss'),
    require('autoprefixer'),
    ...(process.env.NODE_ENV === 'production' ? [require('cssnano')] : []),
  ],
}
```

### autoprefixer

根据 `browserslist` 自动添加厂商前缀，无需手动写 `-webkit-`：

```css
/* 输入 */
.box {
  display: flex;
  user-select: none;
}
```

```css
/* 输出（根据目标浏览器自动添加） */
.box {
  display: -webkit-box;
  display: -ms-flexbox;
  display: flex;
  -webkit-user-select: none;
  -moz-user-select: none;
  user-select: none;
}
```

### postcss-preset-env

允许使用尚未被广泛支持的现代 CSS 特性：

```css
/* 输入：CSS 嵌套（现代语法） */
.card {
  color: red;

  & .title {
    font-size: 1.5rem;
  }
}
```

```css
/* 输出：展开的传统写法 */
.card { color: red; }
.card .title { font-size: 1.5rem; }
```

```js title="postcss.config.js"
module.exports = {
  plugins: [
    require('postcss-preset-env')({
      stage: 2,          // 0~4，数字越小支持的草案特性越激进
      features: {
        'nesting-rules': true,
        'custom-media-queries': true,
      },
    }),
  ],
}
```

### 在 Webpack 中使用

```js title="webpack.config.js"
module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader',
          'postcss-loader', // 在 css-loader 之前处理
        ],
      },
    ],
  },
}
```

### 在 Vite 中使用

Vite 内置 PostCSS 支持，只需在项目根目录放 `postcss.config.js` 即可自动生效：

```js title="postcss.config.js"
module.exports = {
  plugins: [require('autoprefixer'), require('postcss-preset-env')({ stage: 2 })],
}
```

也可在 `vite.config.ts` 中内联配置：

```ts title="vite.config.ts"
import autoprefixer from 'autoprefixer'

export default defineConfig({
  css: {
    postcss: {
      plugins: [autoprefixer()],
    },
  },
})
```

### 自定义 PostCSS Plugin

**示例：px 转 rem**

```js title="postcss-px-to-rem.js"
const postcss = require('postcss')

module.exports = postcss.plugin('postcss-px-to-rem', (options = {}) => {
  const rootValue = options.rootValue || 16
  const unitPrecision = options.unitPrecision || 4

  return (root) => {
    root.walkDecls((decl) => {
      if (!decl.value.includes('px')) return
      decl.value = decl.value.replace(/(\d*\.?\d+)px/g, (_, p1) => {
        return `${(parseFloat(p1) / rootValue).toFixed(unitPrecision)}rem`
      })
    })
  }
})
```

---

## 三者协同工作

一个典型的现代前端项目中，三个工具各司其职：

```
源代码（TS + JSX + 现代 CSS）
        ↓
  Babel / SWC        → JS 语法转换、polyfill 注入
        ↓
  Webpack / Vite     → 模块打包、资源处理
        ↓
   PostCSS           → CSS 厂商前缀、现代语法降级、压缩
        ↓
  输出（兼容目标浏览器的 JS + CSS）
```

### browserslist — 统一目标浏览器配置

Babel、autoprefixer、postcss-preset-env 都依赖 `browserslist` 确定目标浏览器范围，统一在一处配置，避免各工具目标不一致：

```json title="package.json"
{
  "browserslist": [
    "> 1%",
    "last 2 versions",
    "not dead",
    "not ie 11"
  ]
}
```

或单独用 `.browserslistrc` 文件：

```
> 1%
last 2 versions
not dead
not ie 11
```

:::tip[browserslist 是三个工具的共同语言]
配置一次，Babel 知道要转换哪些语法，autoprefixer 知道要加哪些前缀，postcss-preset-env 知道要降级哪些 CSS 特性。统一配置后，兼容性处理就有了一致的基准。
:::
