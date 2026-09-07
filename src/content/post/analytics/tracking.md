---
title: "埋点 SDK 设计与实现"
description: "从零实现一个前端埋点 SDK，涵盖访客识别、事件采集、错误监控、PV 上报、性能指标采集与数据上报策略"
publishDate: "2026-05-13T21:13:11.662Z"
updatedDate: "2026-09-07T21:12:00.303Z"
tags: ["埋点", "监控", "sendBeacon", "web-vitals", "性能"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---
# 埋点 SDK 设计与实现

埋点（Event Tracking）是数据采集的基础，用于记录用户行为、页面访问、异常错误、性能指标等数据，为产品迭代和线上监控提供依据。

本文基于一个完整的前端埋点 SDK 实现，逐模块拆解其设计思路。

## 整体架构

SDK 采用**模块化设计**，核心类 `Tracker` 负责初始化协调，各功能独立成模块：

```
Tracker (核心类)
├── uv         访客识别（设备指纹 + 浏览器信息）
├── event      事件埋点（点击行为采集）
├── error      错误监控（JS 错误 + Promise 错误）
├── pv         页面浏览（hash / history 路由兼容）
├── performance 性能指标（Web Vitals）
└── report     数据上报（sendBeacon / fetch）
```

### 核心类

```ts
import { getFingerprint } from '@/uv'
import { reportEvent } from '@/event'
import { reportError } from '@/error'
import { reportPv } from '@/pv'
import { reportPerformance } from '@/performance'
import { reportFetch } from '@/report'

export class Tracker {
  private config: TrackerConfig
  private visitorId: string | null = null
  private initPromise: Promise<void> | null = null

  constructor(config: TrackerConfig) {
    this.config = config
    this.init()
  }

  protected async init() {
    if (this.initPromise) return this.initPromise
    this.initPromise = (async () => {
      this.visitorId = await getFingerprint(this.config)
      reportEvent(this.visitorId, this.config)
      reportError(this.visitorId, this.config)
      reportPv(this.visitorId, this.config)
      reportPerformance(this.visitorId, this.config)
    })()
    return this.initPromise
  }

  public async setUserId(userId: string) {
    await this.init()
    const url = this.config.baseUrl + this.config.uv.updateApi
    await reportFetch(url, { visitorId: this.visitorId, userId })
  }
}
```

几个设计细节：

- **Promise 单例**：`initPromise` 保证 `init()` 只执行一次，即使被多次调用
- **异步初始化**：访客 ID 依赖网络请求，其他模块等 ID 生成后再启动
- `**setUserId**`：用户登录后调用，将匿名访客与真实用户关联

### 配置结构

```ts
interface TrackerConfig {
  baseUrl: string
  uv: { api: string; updateApi: string }
  event: { api: string }
  error: { api: string }
  pv: { api: string }
  performance: { api: string }
}
```

使用方式：

```ts
const tracker = new Tracker({
  baseUrl: 'https://your-api.com',
  uv: { api: '/uv', updateApi: '/uv/update' },
  event: { api: '/event' },
  error: { api: '/error' },
  pv: { api: '/pv' },
  performance: { api: '/performance' },
})

// 用户登录后关联 userId
tracker.setUserId('user_123')
```

---

## UV — 访客识别

访客识别的核心问题是：**如何在不登录的情况下识别同一个人**。

常见方案是生成设备指纹（Fingerprint）——基于浏览器版本、系统、硬件信息等计算出一个哈希值，同一设备每次访问得到的值相同。

```ts
import FingerprintJS from '@fingerprintjs/fingerprintjs'
import { UAParser } from 'ua-parser-js'

export const getBrowserInfo = () => {
  const ua = new UAParser()
  return {
    browser: ua.getBrowser().name,
    os: ua.getOS().name,
    device: ua.getDevice().type || 'desktop',
  }
}

export const getFingerprint = async (config: TrackerConfig) => {
  const browserInfo = getBrowserInfo()
  const fp = await FingerprintJS.load()
  const result = await fp.get()

  const body: UvDto = {
    anonymousId: result.visitorId, // 设备指纹
    browser: browserInfo.browser,
    os: browserInfo.os,
    device: browserInfo.device,
  }

  const url = config.baseUrl + config.uv.api
  const res = await reportFetch(url, body)
  return res.data // 后端返回的统一访客 ID
}
```

流程：

1. `FingerprintJS` 生成设备指纹 `anonymousId`
2. `ua-parser-js` 解析浏览器、系统、设备类型
3. 上报给后端，后端查重后返回统一的 `visitorId`
4. 后续所有模块都携带这个 `visitorId` 上报

:::caution[设备指纹并非 100% 稳定]
换浏览器、清缓存、无痕模式、系统升级都可能导致指纹变化，同一用户会被识别成不同访客。生产环境建议结合 Cookie/LocalStorage 持久化 `visitorId`，登录后再与真实用户 ID 关联，而不是完全依赖指纹。
:::

---

## Event — 事件埋点

记录用户点击行为，采集点击位置、元素尺寸、文本内容等。

```ts
export const reportEvent = (visitorId: string, config: TrackerConfig) => {
  const url = config.baseUrl + config.event.api

  document.addEventListener('click', (e: MouseEvent) => {
    const target = e.target as HTMLElement
    const isButton = target.nodeName === 'BUTTON'
    const isButtonChild = target.nodeName === 'SPAN' && target.parentElement?.nodeName === 'BUTTON'

    if (!isButton && !isButtonChild) return

    const rect = target.getBoundingClientRect()
    const body: EventDto = {
      visitorId,
      event: e.type,
      payload: {
        x: rect.left.toFixed(2),
        y: rect.top.toFixed(2),
        width: rect.width.toFixed(2),
        height: rect.height.toFixed(2),
        text: target.textContent,
      },
      url: window.location.href,
    }
    report(url, body)
  })
}
```

使用**事件委托**在 `document` 上监听，避免对每个元素单独绑定。目前只采集 `<button>` 及其子元素的点击，可按需扩展。

**扩展思路：自定义属性标记**

更通用的方案是通过 `data-track` 属性标记需要采集的元素，而不是硬编码标签名：

```html
<button data-track="purchase-btn">立即购买</button>
```

```ts
document.addEventListener('click', (e: MouseEvent) => {
  const target = (e.target as HTMLElement).closest('[data-track]')
  if (!target) return
  report(url, {
    visitorId,
    event: target.getAttribute('data-track'),
    url: window.location.href,
  })
})
```

---

## Error — 错误监控

捕获两类全局错误：JS 运行时错误和未处理的 Promise 错误。

```ts
export const reportError = (visitorId: string, config: TrackerConfig) => {
  const url = config.baseUrl + config.error.api

  // JS 运行时错误
  window.addEventListener('error', (e: ErrorEvent) => {
    report(url, {
      visitorId,
      error: 'js',
      message: e.message,
      stack: e.error?.stack,
      url: e.filename,
    })
  })

  // 未处理的 Promise 错误
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const isError = e.reason instanceof Error
    report(url, {
      visitorId,
      error: 'promise',
      message: isError ? e.reason.message : JSON.stringify(e.reason),
      stack: isError ? e.reason.stack : 'Promise Rejection',
      url: window.location.href,
    })
  })
}
```

两个事件覆盖了前端绝大多数错误场景：


| 事件                   | 捕获范围                                       |
| -------------------- | ------------------------------------------ |
| `window.error`       | 同步错误、资源加载错误（img/script 等）                  |
| `unhandledrejection` | `async/await` 未 catch 的错误、`Promise.reject` |


**扩展思路：资源加载错误**

`window.error` 可以捕获脚本/样式/图片加载失败，但需要判断 `e.target`：

```ts
window.addEventListener('error', (e) => {
  const target = e.target as HTMLElement
  if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement || target instanceof HTMLImageElement) {
    report(url, {
      visitorId,
      error: 'resource',
      message: `资源加载失败: ${(target as any).src || (target as any).href}`,
    })
    return
  }
  // 普通 JS 错误
  report(url, { visitorId, error: 'js', message: (e as ErrorEvent).message })
}, true) // 资源加载错误不冒泡，必须用捕获阶段（第三个参数 true）才能拦截到
```

---

## PV — 页面浏览

PV（Page View）记录每次页面访问。SPA 路由切换不会触发整页刷新，需要分别处理 hash 和 history 两种模式。

```ts
const reportView = (visitorId: string, config: TrackerConfig) => {
  const url = config.baseUrl + config.pv.api
  const isHash = window.location.href.includes('#')
  report(url, {
    visitorId,
    url: window.location.protocol + '//' + window.location.host,
    referrer: document.referrer,
    path: isHash ? '/' + window.location.hash : window.location.pathname,
  })
}

export const reportPv = (visitorId: string, config: TrackerConfig) => {
  reportView(visitorId, config) // 首次进入立即上报

  // Hash 路由
  window.addEventListener('hashchange', () => reportView(visitorId, config))

  // History 路由：浏览器前进/后退
  window.addEventListener('popstate', () => reportView(visitorId, config))

  // History 路由：router.push / router.replace（不触发 popstate）
  const originalPushState = history.pushState
  history.pushState = function (...args) {
    originalPushState.apply(this, args)
    reportView(visitorId, config)
  }

  const originalReplaceState = history.replaceState
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args)
    reportView(visitorId, config)
  }
}
```

`history.pushState` 和 `history.replaceState` 本身不触发任何事件，所以需要对原方法进行**猴子补丁（Monkey Patch）**，在调用原逻辑后额外上报一次。

覆盖的路由场景：


| 场景               | 处理方式                      |
| ---------------- | ------------------------- |
| Hash 路由切换        | `hashchange`              |
| 浏览器前进 / 后退       | `popstate`                |
| `router.push`    | 重写 `history.pushState`    |
| `router.replace` | 重写 `history.replaceState` |
| 首次进入             | 直接调用一次                    |


---

## Performance — 性能指标

采集 [Web Vitals](https://web.dev/vitals/) 核心指标，衡量用户真实体验。

```ts
import { onINP, onCLS } from 'web-vitals'

export const reportPerformance = async (visitorId: string, config: TrackerConfig) => {
  const url = config.baseUrl + config.performance.api
  let fp = 0, fcp = 0, lcp = 0, inp = 0, cls = 0

  // FP 和 FCP（已存在于 Paint Timing API）
  const paintEntries = performance.getEntriesByType('paint')
  fp = paintEntries.find(e => e.name === 'first-paint')?.startTime ?? 0
  fcp = paintEntries.find(e => e.name === 'first-contentful-paint')?.startTime ?? 0

  // LCP（需要 Observer 异步获取）
  const { lcpTime, observer } = await new Promise<{ lcpTime: number; observer: PerformanceObserver }>(resolve => {
    const ob = new PerformanceObserver(list => {
      resolve({ lcpTime: list.getEntries().at(-1)?.startTime ?? 0, observer: ob })
    })
    ob.observe({ type: 'largest-contentful-paint', buffered: true })
  })
  observer.disconnect()
  lcp = lcpTime

  // INP 和 CLS（依赖 web-vitals 库）
  onINP(metric => { inp = metric.value })
  onCLS(metric => { cls = metric.value })

  // 页面隐藏时统一上报（确保 INP/CLS 已累积完毕）
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      report(url, { visitorId, fp, fcp, lcp, inp, cls })
    }
  }, { once: true })
}
```

各指标说明：


| 指标  | 全称                        | 含义     | 良好阈值       |
| --- | ------------------------- | ------ | ---------- |
| FP  | First Paint               | 首次像素绘制 | &lt; 1s    |
| FCP | First Contentful Paint    | 首次内容绘制 | &lt; 1.8s  |
| LCP | Largest Contentful Paint  | 最大内容绘制 | &lt; 2.5s  |
| INP | Interaction to Next Paint | 交互响应延迟 | &lt; 200ms |
| CLS | Cumulative Layout Shift   | 累积布局偏移 | &lt; 0.1   |


:::note[为什么在 visibilitychange 时上报]
INP 和 CLS 是累积值，页面使用过程中会持续变化，只有用户离开时才是最终结果。在此时上报能保证数据完整性。`{ once: true }` 确保监听器只触发一次，避免用户多次切换标签时重复上报。
:::

---

## Report — 数据上报

上报模块提供两种方式，根据是否需要响应来选择：

```ts
// 无需响应：sendBeacon，不阻塞页面，页面卸载时也能发出
export const report = (url: string, body: any) => {
  const blob = new Blob([JSON.stringify(body)], { type: 'application/json' })
  navigator.sendBeacon(url, blob)
}

// 需要响应：fetch，用于获取后端返回值（如 visitorId）
export const reportFetch = async (url: string, body: any) => {
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    keepalive: true, // 页面卸载时仍能完成请求
    headers: { 'Content-Type': 'application/json' },
  })
  return res.json()
}
```

两种上报方式对比：


|        | `sendBeacon` | `fetch + keepalive` |
| ------ | ------------ | ------------------- |
| 是否阻塞   | 否            | 否（keepalive）        |
| 页面卸载时  | 可靠发出         | 可靠发出                |
| 能否获取响应 | 否            | 是                   |
| 数据大小限制 | 64KB         | 较大                  |
| 适用场景   | 埋点、日志、性能上报   | 需要后端返回值（如 UV）       |


SDK 内部的使用原则：

- UV 初始化用 `reportFetch`，因为需要拿到后端返回的 `visitorId`
- 其余所有上报用 `report`（sendBeacon），保证轻量不阻塞

---

## 构建与打包

SDK 使用 Vite 打包，同时输出多种模块格式：

```ts
// vite.config.ts
build: {
  lib: {
    entry: 'index.ts',
    name: 'tracker',
    fileName: 'tracker',
    formats: ['es', 'cjs', 'umd', 'iife'], // 支持 ESM / CJS / CDN 引入
  },
  minify: true,
}
```

配合 `vite-plugin-dts` 生成 `.d.ts` 类型声明文件，消费方可以获得完整的 TypeScript 类型提示。

---

## 扩展方向

当前 SDK 已覆盖核心场景，以下是可以继续完善的方向：

**采集增强**

- 自定义属性标记（`data-track`），替代硬编码标签名
- 资源加载错误监控（图片、脚本、字体）
- 页面停留时长统计
- 曝光埋点（IntersectionObserver 监听元素进入视口）

**上报优化**

- 本地队列 + 批量上报，减少请求次数
- 失败重试（IndexedDB 持久化待发队列）
- 采样率控制，高流量下按比例上报

**访客识别增强**

- LocalStorage / Cookie 持久化 visitorId，避免重复请求
- 结合指纹与存储的混合方案提升稳定性

