---
title: "Vite 核心原理与实践"
description: "深入理解 Vite 的开发服务器原理、与 webpack 的核心差异、常用配置、构建优化，以及如何编写自定义 plugin"
publishDate: "2026-05-14T00:00:00.000Z"
updatedDate: ""
tags: ["vite", "构建工具", "rollup", "plugin", "优化"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Vite 核心原理与实践

Vite 是新一代前端构建工具，开发模式下利用浏览器原生 ESM 实现极速启动，生产构建基于 Rollup。

## 为什么 Vite 开发时更快

### Webpack 的问题

Webpack 在启动开发服务器时，需要先**从入口出发打包所有模块**，生成完整 bundle 后才能响应请求。项目越大，等待时间越长。

```
启动 → 打包全部模块（可能几十秒）→ 启动完成 → 浏览器请求
```

### Vite 的方案

Vite 利用现代浏览器支持原生 `<script type="module">` 的特性，**按需编译**：

```
启动（极快，< 1s）→ 浏览器请求某个模块 → Vite 实时编译该模块 → 返回
```

两个核心优化：

**1. 依赖预构建（Pre-bundling）**

第三方库通常是 CommonJS 格式，且依赖关系复杂（lodash 有几百个子模块）。Vite 启动时用 **esbuild**（Go 编写，比 babel 快 10~100 倍）将它们预构建成单个 ESM 文件并缓存到 `node_modules/.vite/deps/`。

```
node_modules/lodash → .vite/deps/lodash.js（单文件 ESM，浏览器一次请求即可）
```

**2. 源码按需转换**

业务代码在浏览器请求时才由 Vite 实时转换，无需提前全量打包。HMR 更新时也只重新处理变化的模块，精准快速。

---

## 与 Webpack 的核心差异

| | Webpack | Vite |
| --- | --- | --- |
| 开发模式原理 | Bundle-based（全量打包后提供服务） | ESM-based（按需编译） |
| 启动速度 | 随项目规模增大变慢 | 始终极快（与项目大小基本无关） |
| HMR 速度 | 重新打包受影响的 chunk | 只更新变化的模块，精准快速 |
| 生产构建 | 自身打包器 | Rollup |
| 配置复杂度 | 较高，需要手动配置很多 | 开箱即用，常见场景零配置 |
| 生态 | 非常成熟，loader/plugin 数量庞大 | 快速增长，兼容大部分 Rollup plugin |
| 适用场景 | 大型复杂项目、需要精细控制 | 现代项目的首选 |

:::note[生产构建的一致性]
Vite 开发模式用原生 ESM，生产模式用 Rollup 打包，两者在某些边缘行为上存在差异（如 CommonJS 依赖的处理）。如果发现开发正常但生产报错，通常是这个原因。
:::

---

## 常用配置

```ts title="vite.config.ts"
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia'],
          lodash: ['lodash-es'],
        },
      },
    },
  },

  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`,
      },
    },
  },
})
```

### 环境变量

Vite 使用 `.env` 文件管理环境变量。

```bash title=".env.development"
VITE_API_URL=http://localhost:4000
```

```bash title=".env.production"
VITE_API_URL=https://api.example.com
```

:::important[VITE_ 前缀]
只有 `VITE_` 前缀的变量才会暴露给客户端代码。没有前缀的变量仅在 `vite.config.ts` 中可访问，不会打包进产物，防止意外暴露敏感信息。
:::

```ts
console.log(import.meta.env.VITE_API_URL)
console.log(import.meta.env.MODE)   // development | production
console.log(import.meta.env.DEV)    // boolean
console.log(import.meta.env.PROD)   // boolean
```

---

## 构建优化

### 手动分割 chunk

```ts title="vite.config.ts"
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            const pkg = id.match(/node_modules\/([^/]+)/)?.[1]
            if (['vue', 'vue-router', 'pinia'].includes(pkg)) return 'vue-core'
            if (pkg === 'lodash-es') return 'lodash'
            return 'vendor'
          }
        },
      },
    },
  },
})
```

### 动态导入（懒加载）

```ts
const routes = [
  {
    path: '/dashboard',
    component: () => import('./pages/Dashboard.vue'), // 单独打包成独立 chunk
  },
]
```

### 静态资源内联阈值

```ts title="vite.config.ts"
export default defineConfig({
  build: {
    assetsInlineLimit: 4096, // 小于 4KB 的资源转为 base64 内联，减少请求数
  },
})
```

### 依赖预构建

```ts title="vite.config.ts"
export default defineConfig({
  optimizeDeps: {
    include: ['lodash-es', 'axios'], // 强制预构建（适合被动态导入的依赖）
    exclude: ['your-local-lib'],
  },
})
```

### 移除 console

```ts title="vite.config.ts"
export default defineConfig({
  build: {
    minify: 'esbuild',
    // 如需更高压缩率，改用 terser（需安装）：
    // minify: 'terser',
    // terserOptions: { compress: { drop_console: true, drop_debugger: true } },
  },
  esbuild: {
    drop: ['console', 'debugger'], // esbuild 原生支持，速度更快
  },
})
```

### 分析构建产物

```bash
npm install --save-dev rollup-plugin-visualizer
```

```ts title="vite.config.ts"
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    visualizer({ open: true, gzipSize: true, filename: 'stats.html' }),
  ],
})
```

---

## Plugin 原理与自定义

Vite 插件基于 **Rollup 插件接口**扩展，同时提供了一些 Vite 特有的钩子。

### 通用钩子（开发和构建都会执行）

| 钩子 | 触发时机 |
| --- | --- |
| `resolveId` | 解析模块路径 |
| `load` | 加载模块内容 |
| `transform` | 转换模块代码 |
| `generateBundle` | 生成产物前，可修改/添加输出文件 |
| `writeBundle` | 产物写入磁盘后 |

### Vite 特有钩子（仅开发模式）

| 钩子 | 触发时机 |
| --- | --- |
| `configResolved` | 最终配置确定后 |
| `configureServer` | 配置开发服务器，可添加中间件 |
| `transformIndexHtml` | 转换 `index.html` |
| `handleHotUpdate` | 自定义 HMR 更新逻辑 |

### 实现一个自定义 Plugin

**示例：将 `__BUILD_TIME__` 替换为构建时间**

```ts title="plugins/build-time.ts"
import type { Plugin } from 'vite'

export function buildTimePlugin(): Plugin {
  const buildTime = new Date().toISOString()

  return {
    name: 'vite-plugin-build-time',

    transform(code, id) {
      if (!/\.[jt]sx?$/.test(id)) return
      if (!code.includes('__BUILD_TIME__')) return
      return code.replace(/__BUILD_TIME__/g, JSON.stringify(buildTime))
    },
  }
}
```

**示例：虚拟模块（Virtual Module）**

虚拟模块允许你「凭空」创建一个可被 `import` 的模块，常用于注入编译时配置。

```ts title="plugins/virtual-config.ts"
import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:app-config'
const RESOLVED_ID = '\0' + VIRTUAL_ID // \0 前缀是 Rollup 约定，标记为内部虚拟模块

export function virtualConfigPlugin(config: Record<string, any>): Plugin {
  return {
    name: 'vite-plugin-virtual-config',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },

    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(config)}`
      }
    },
  }
}
```

:::note[为什么需要 `\0` 前缀]
以 `\0` 开头的模块 ID 告诉 Rollup/Vite 这是一个内部虚拟模块，不要尝试去文件系统中查找它，也不会被其他插件误处理。
:::

使用：

```ts title="vite.config.ts"
import { virtualConfigPlugin } from './plugins/virtual-config'

export default defineConfig({
  plugins: [virtualConfigPlugin({ appName: 'My App', version: '1.0.0' })],
})
```

```ts title="src/main.ts"
import config from 'virtual:app-config'
console.log(config.appName) // 'My App'
```

**示例：开发服务器添加 Mock 接口**

```ts title="plugins/mock-api.ts"
import type { Plugin } from 'vite'

export function mockApiPlugin(): Plugin {
  return {
    name: 'vite-plugin-mock-api',
    apply: 'serve', // 只在开发模式生效

    configureServer(server) {
      server.middlewares.use('/api/user', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ id: 1, name: 'Alice' }))
      })
    },
  }
}
```

### apply 和 enforce

```ts
export function myPlugin(): Plugin {
  return {
    name: 'my-plugin',
    apply: 'build',  // 'serve'（开发）| 'build'（生产）| 不填（两者）
    enforce: 'pre',  // 'pre'（内置插件之前）| 'post'（内置插件之后）| 不填（中间）
  }
}
```

---

## HMR API

在业务代码或插件中可以使用 Vite 的 HMR API：

```ts
if (import.meta.hot) {
  // 接受自身更新
  import.meta.hot.accept((newModule) => {
    // 用新模块重新初始化
  })

  // 接受依赖更新
  import.meta.hot.accept('./dep.ts', (newDep) => {
    // dep.ts 更新时触发
  })

  // 模块卸载时清理副作用（如定时器、事件监听）
  import.meta.hot.dispose(() => {
    clearInterval(timer)
  })
}
```

:::tip[不接受更新的模块会冒泡]
如果一个模块没有调用 `import.meta.hot.accept`，HMR 更新会沿依赖链向上冒泡，直到找到一个接受更新的祖先模块，或者触发整页刷新。
:::
