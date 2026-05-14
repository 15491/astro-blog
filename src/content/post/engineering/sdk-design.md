---
title: "如何封装一个 SDK"
description: "从设计原则到工程细节，系统梳理封装 SDK 的核心模式：初始化、API 设计、错误处理、插件机制、类型安全、事件系统与 npm 发布"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["SDK", "TypeScript", "npm", "架构设计", "插件"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 如何封装一个 SDK

SDK（Software Development Kit）和普通工具函数的区别在于**边界感**：SDK 是一套完整的能力集合，对外暴露稳定的接口契约，对内可以随意重构。

封装 SDK 时需要提前想清楚三个问题：**调用方怎么初始化**、**出了错怎么感知**、**能力不够怎么扩展**。本文围绕这三个问题展开。

## SDK 的基本形态

一个 SDK 通常长这样：

```ts
// 初始化一次
const sdk = new MySDK({ appId: 'xxx', env: 'prod' })

// 多处调用
sdk.track('button_click', { page: 'home' })
sdk.identify('user_123')

// 或者函数式风格
import { init, track } from 'my-sdk'
init({ appId: 'xxx' })
track('button_click')
```

两种风格本质上没有优劣，类实例适合需要隔离多份配置的场景（如多租户），函数式适合全局单例。

实际上函数式 SDK 内部往往也是类实例，只是通过模块作用域的单例来暴露函数 API：

```ts title="src/index.ts"
let instance: MySDK | null = null

export const init = (config: SDKConfig) => {
  instance = new MySDK(config)
}

export const track = (event: string, data?: object) => {
  if (!instance) throw new SDKError('SDK 未初始化，请先调用 init()')
  return instance.track(event, data)
}
```

---

## 初始化设计

### 必填 vs 可选配置

将配置分为两类：**必须由调用方提供的**和**有合理默认值的**：

```ts
interface SDKConfig {
  // 必填：没有这个 SDK 完全无法工作
  appId: string
  endpoint: string

  // 可选：有默认值
  timeout?: number        // default: 5000
  maxRetry?: number       // default: 3
  debug?: boolean         // default: false
  env?: 'dev' | 'prod'   // default: 'prod'
}
```

初始化时合并默认值：

```ts title="src/core.ts"
const DEFAULT_CONFIG: Required<Omit<SDKConfig, 'appId' | 'endpoint'>> = {
  timeout: 5000,
  maxRetry: 3,
  debug: false,
  env: 'prod',
}

export class MySDK {
  private config: Required<SDKConfig>

  constructor(config: SDKConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.bootstrap()
  }

  private bootstrap() {
    if (this.config.debug) {
      console.log('[SDK] 初始化完成', this.config)
    }
  }
}
```

### 防止重复初始化

全局 SDK 通常只应该初始化一次，多次初始化是调用方的错误，应该明确告知：

```ts
let initialized = false

export const init = (config: SDKConfig) => {
  if (initialized) {
    console.warn('[SDK] 已经初始化过，重复调用 init() 无效')
    return
  }
  instance = new MySDK(config)
  initialized = true
}
```

---

## API 设计原则

### 最小化暴露面

对外暴露的方法越少，后期维护的负担越小。内部方法用 `private`，只有真正需要调用方使用的才暴露：

```ts
export class MySDK {
  // 对外 API
  public track(event: string, data?: object): void { ... }
  public identify(userId: string): void { ... }
  public destroy(): void { ... }

  // 内部实现，调用方不需要关心
  private buildPayload(event: string, data?: object) { ... }
  private sendRequest(payload: object): Promise<void> { ... }
  private getTimestamp(): number { ... }
}
```

### 链式调用（Fluent API）

对于配置类 SDK，链式调用能让代码更易读：

```ts
// 命令式（冗长）
const request = new HttpClient()
request.setBaseURL('https://api.example.com')
request.setTimeout(5000)
request.setHeaders({ 'Content-Type': 'application/json' })

// 链式（清晰）
const request = new HttpClient()
  .baseURL('https://api.example.com')
  .timeout(5000)
  .headers({ 'Content-Type': 'application/json' })
```

实现方式是每个方法返回 `this`：

```ts
class HttpClient {
  private _config: Config = {}

  baseURL(url: string): this {
    this._config.baseURL = url
    return this  // 关键：返回 this 才能链式调用
  }

  timeout(ms: number): this {
    this._config.timeout = ms
    return this
  }
}
```

### 同步优先，异步透明

能同步完成的操作不要包成 Promise。异步操作要让调用方能够选择是否等待：

```ts
// ✅ 上报事件不需要等结果，fire and forget
sdk.track('click', { btn: 'submit' })

// ✅ 需要结果时才 await
const result = await sdk.fetchConfig()

// ❌ 不要把不需要等待的操作强制变成异步
await sdk.track('click') // 调用方被迫 await，体验差
```

---

## 错误处理

### 自定义错误类型

SDK 应该有自己的错误类，方便调用方区分是 SDK 报错还是业务报错：

```ts title="src/errors.ts"
export class SDKError extends Error {
  public code: string
  public details?: unknown

  constructor(message: string, code: string, details?: unknown) {
    super(message)
    this.name = 'SDKError'
    this.code = code
    this.details = details
    // 保证 instanceof 在转译后依然有效
    Object.setPrototypeOf(this, SDKError.prototype)
  }
}

// 具体错误类型继承
export class SDKNetworkError extends SDKError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', details)
    this.name = 'SDKNetworkError'
    Object.setPrototypeOf(this, SDKNetworkError.prototype)
  }
}

export class SDKConfigError extends SDKError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR')
    this.name = 'SDKConfigError'
    Object.setPrototypeOf(this, SDKConfigError.prototype)
  }
}
```

调用方可以针对性处理：

```ts
try {
  await sdk.upload(data)
} catch (err) {
  if (err instanceof SDKNetworkError) {
    // 网络问题，可以重试
    retry()
  } else if (err instanceof SDKError) {
    // SDK 其他错误
    console.error('SDK 错误:', err.code, err.message)
  } else {
    throw err  // 不是 SDK 的错误，继续向上抛
  }
}
```

### 错误码规范

统一定义错误码，方便排查和文档化：

```ts title="src/error-codes.ts"
export const ERROR_CODES = {
  NOT_INITIALIZED:  'SDK_001',
  INVALID_CONFIG:   'SDK_002',
  NETWORK_TIMEOUT:  'SDK_003',
  UNAUTHORIZED:     'SDK_004',
  RATE_LIMITED:     'SDK_005',
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]
```

:::tip[错误信息要对开发者友好]
SDK 的错误信息的受众是开发者，不是终端用户。要直接说明问题和修复方式：

```
❌ "操作失败"
✅ "SDK 未初始化，请在调用其他方法前先调用 init({ appId: '...' })"
```
:::

---

## 事件系统

许多 SDK 需要对外发布内部状态变化，比如网络恢复、Token 刷新、上报成功/失败。事件系统比直接在配置里写回调函数更灵活。

### 手写 EventEmitter

```ts title="src/event-emitter.ts"
type EventMap = Record<string, unknown[]>

export class EventEmitter<T extends EventMap> {
  private listeners = new Map<keyof T, Set<(...args: unknown[]) => void>>()

  on<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void)
    return this
  }

  off<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void)
    return this
  }

  once<K extends keyof T>(event: K, handler: (...args: T[K]) => void): this {
    const wrapper = (...args: T[K]) => {
      handler(...args)
      this.off(event, wrapper)
    }
    return this.on(event, wrapper)
  }

  emit<K extends keyof T>(event: K, ...args: T[K]): void {
    this.listeners.get(event)?.forEach(h => h(...args))
  }
}
```

在 SDK 中继承并定义事件类型：

```ts title="src/core.ts"
interface SDKEvents {
  ready: []
  error: [error: SDKError]
  report: [event: string, success: boolean]
  networkChange: [online: boolean]
}

export class MySDK extends EventEmitter<SDKEvents> {
  private async sendRequest(payload: object) {
    try {
      await fetch(this.config.endpoint, { body: JSON.stringify(payload) })
      this.emit('report', payload.event, true)
    } catch (err) {
      const sdkErr = new SDKNetworkError('上报失败', err)
      this.emit('error', sdkErr)
      this.emit('report', payload.event, false)
    }
  }
}
```

调用方监听事件：

```ts
sdk.on('error', (err) => {
  console.error('SDK 错误:', err.code)
})

sdk.on('report', (event, success) => {
  if (!success) retryQueue.push(event)
})
```

---

## 插件机制

当 SDK 的能力需要可扩展时，插件机制比直接在核心类里堆功能要好得多。Axios 的拦截器、Vite 的 plugin 都是这种思路。

### 定义插件接口

```ts title="src/plugin.ts"
export interface SDKPlugin {
  name: string
  // SDK 初始化时调用
  setup?: (sdk: MySDK) => void
  // 每次上报前调用，可以修改 payload
  beforeReport?: (payload: ReportPayload) => ReportPayload | false
  // 上报完成后调用
  afterReport?: (payload: ReportPayload, success: boolean) => void
}
```

### 核心类管理插件

```ts title="src/core.ts"
export class MySDK {
  private plugins: SDKPlugin[] = []

  use(plugin: SDKPlugin): this {
    if (this.plugins.find(p => p.name === plugin.name)) {
      console.warn(`[SDK] 插件 "${plugin.name}" 已注册，跳过重复注册`)
      return this
    }
    this.plugins.push(plugin)
    plugin.setup?.(this)
    return this
  }

  private async report(event: string, data?: object) {
    let payload: ReportPayload = { event, data, timestamp: Date.now() }

    // 经过所有插件的 beforeReport 钩子
    for (const plugin of this.plugins) {
      if (!plugin.beforeReport) continue
      const result = plugin.beforeReport(payload)
      if (result === false) return  // 某个插件决定拦截这次上报
      payload = result
    }

    const success = await this.sendRequest(payload)

    // 触发所有插件的 afterReport 钩子
    this.plugins.forEach(p => p.afterReport?.(payload, success))
  }
}
```

### 写一个插件

```ts title="plugins/user-info-plugin.ts"
import type { SDKPlugin } from 'my-sdk'

// 自动在每个上报 payload 里带上用户信息
export const userInfoPlugin = (getUserInfo: () => object): SDKPlugin => ({
  name: 'user-info',
  beforeReport(payload) {
    return {
      ...payload,
      user: getUserInfo(),
    }
  },
})
```

```ts
sdk.use(userInfoPlugin(() => store.user))
```

:::note[插件机制的核心价值]
插件让 SDK 的核心保持精简，可选能力通过插件按需引入。这也是 Tree Shaking 友好的关键——没有 `use` 的插件代码在打包时会被移除。
:::

---

## 请求队列与重试

网络不稳定时，SDK 需要能排队等待并自动重试，而不是直接丢弃事件：

```ts title="src/queue.ts"
interface QueueItem {
  payload: ReportPayload
  retryCount: number
}

export class ReportQueue {
  private queue: QueueItem[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly maxRetry = 3
  private readonly flushInterval = 2000

  add(payload: ReportPayload) {
    this.queue.push({ payload, retryCount: 0 })
    this.scheduleFlush()
  }

  private scheduleFlush() {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.flushInterval)
  }

  private async flush() {
    if (!this.queue.length) return

    const batch = this.queue.splice(0, 10)  // 每次最多发 10 条

    try {
      await sendBatch(batch.map(i => i.payload))
    } catch {
      // 失败的重新入队，超过重试次数丢弃
      const retry = batch
        .filter(i => i.retryCount < this.maxRetry)
        .map(i => ({ ...i, retryCount: i.retryCount + 1 }))

      this.queue.unshift(...retry)
      this.scheduleFlush()
    }
  }
}
```

---

## 类型安全

### 泛型提升调用体验

让方法的返回类型跟随参数类型变化：

```ts
interface EventDataMap {
  page_view: { path: string; title: string }
  button_click: { btnId: string; label: string }
  purchase: { orderId: string; amount: number }
}

// 约束 data 的类型必须与 event 匹配
track<K extends keyof EventDataMap>(event: K, data: EventDataMap[K]): void {
  ...
}
```

```ts
sdk.track('purchase', { orderId: 'O001', amount: 99 })  // ✅
sdk.track('purchase', { path: '/home' })                 // ❌ 类型错误，IDE 直接提示
```

### 导出完整类型

SDK 的类型定义是接口的一部分，必须随包导出：

```ts title="src/types.ts"
export interface SDKConfig { ... }
export interface SDKPlugin { ... }
export interface ReportPayload { ... }
export type { SDKError, SDKNetworkError } from './errors'
```

```ts title="src/index.ts"
export { MySDK, init, track, identify } from './core'
export type { SDKConfig, SDKPlugin, ReportPayload } from './types'
export { SDKError, SDKNetworkError } from './errors'
```

---

## 打包与发布

### package.json 配置

现代 npm 包需要同时支持 ESM 和 CJS，并提供类型声明：

```json title="package.json"
{
  "name": "my-sdk",
  "version": "1.0.0",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "sideEffects": false
}
```

:::tip[sideEffects: false]
声明 `"sideEffects": false` 告诉打包工具这个包没有副作用，可以安全地 Tree Shake。调用方只 import 了 `track`，那 `identify` 的代码就会被移除。
:::

### Vite lib 模式打包

```ts title="vite.config.ts"
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'MySDK',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      // 不把这些打进 SDK，由调用方自己提供
      external: ['vue', 'react'],
    },
  },
  plugins: [
    dts({ insertTypesEntry: true }),  // 自动生成 .d.ts
  ],
})
```

---

## 整体结构

```
my-sdk/
├── src/
│   ├── core.ts           # SDK 主类，对外接口
│   ├── errors.ts         # 自定义错误类
│   ├── event-emitter.ts  # 事件系统
│   ├── queue.ts          # 请求队列与重试
│   ├── types.ts          # 所有类型定义
│   └── index.ts          # 入口，汇总导出
├── plugins/              # 官方插件
│   ├── user-info.ts
│   └── session.ts
├── package.json
└── vite.config.ts
```

---

## 小结

| 问题 | 解决方案 |
|------|----------|
| 调用方怎么初始化 | 必填/可选配置分离，默认值合并，防重复初始化 |
| 出了错怎么感知 | 自定义错误类 + 错误码，事件系统上报错误 |
| 能力不够怎么扩展 | 插件机制（setup / beforeReport / afterReport 钩子） |
| 网络不稳定怎么办 | 请求队列 + 指数退避重试 |
| 类型不够准确 | 泛型约束事件参数，完整导出类型声明 |
| 调用方 Bundle 太大 | ESM 导出 + `sideEffects: false`，支持 Tree Shaking |

SDK 和组件库一样，**稳定的接口比完美的实现更重要**。一旦发布就有人依赖，改接口的代价远比改内部实现高。设计阶段多花时间想清楚对外的 API 形状，比后期打补丁省力得多。
