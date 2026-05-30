---
title: "前端监控与错误上报"
description: "从错误捕获、性能采集到行为埋点，系统梳理前端监控体系的建设方案：上报策略、采样率控制与自建 vs Sentry 的选型"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: "2026-05-30T17:14:03.757Z"
tags: ["监控", "错误上报", "性能", "Sentry", "工程实践"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 前端监控与错误上报

前端监控解决的核心问题是**线上问题的可见性**：用户遇到了 bug，你能在他反馈之前就知道；页面卡顿了，你有数据支撑定位根因。

监控体系有三个维度：**错误监控**（出了什么问题）、**性能监控**（慢在哪里）、**行为监控**（用户做了什么）。三者缺一不可，但优先级依次降低——先保错误可见，再做性能，最后做行为。

:::note[与埋点的区别]
本文侧重**异常告警**（出了问题第一时间知道）。业务埋点（用户行为分析、转化漏斗）请参考 tracking 相关文章。
:::

---

## 一、JS 错误捕获

### 全局错误监听

```ts title="src/monitor/error.ts"
// 捕获同步错误和未被 catch 的 Promise rejection
export function initErrorMonitor() {
  // 同步运行时错误
  window.addEventListener('error', (event) => {
    // 过滤资源加载错误（img/script/link）
    if (event.target instanceof HTMLElement) return

    report({
      type: 'js_error',
      message: event.message,
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    })
  }, true)

  // 未处理的 Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    report({
      type: 'promise_error',
      message: String(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack : undefined,
    })
  })
}
```

### 资源加载错误

```ts
// 图片、脚本、样式加载失败
window.addEventListener('error', (event) => {
  const target = event.target
  if (!(target instanceof HTMLElement)) return

  const tag = target.tagName.toLowerCase()
  const src = (target as HTMLImageElement | HTMLScriptElement).src
    || (target as HTMLLinkElement).href

  report({
    type: 'resource_error',
    tag,
    src,
  })
}, true)  // 必须在捕获阶段，资源错误不会冒泡
```

### 框架内的错误边界

`window.onerror` 捕获不到 Vue / React 组件内部的渲染错误，需要框架自己的机制：

```ts title="src/main.ts"
// Vue 3
app.config.errorHandler = (err, instance, info) => {
  report({
    type: 'vue_error',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    componentName: instance?.$options?.name,
    lifecycleHook: info,
  })
  // 不要吞掉错误，继续抛出让开发环境能看到
  throw err
}
```

```tsx
// React：Error Boundary 组件
class ErrorBoundary extends React.Component {
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    report({
      type: 'react_error',
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }
}
```

### try/catch 的粒度

```ts
// ❌ catch 太宽泛，吞掉了所有错误，监控无法感知
async function loadData() {
  try {
    const data = await fetchUser()
    render(data)
  } catch (e) {
    showError()  // 错误被吞，上报缺失
  }
}

// ✅ catch 里主动上报，再决定是否继续抛出
async function loadData() {
  try {
    const data = await fetchUser()
    render(data)
  } catch (e) {
    report({ type: 'api_error', message: String(e) })
    showError()
    // 如果上层还需要感知，继续 throw
    // throw e
  }
}
```

---

## 二、性能指标采集

### Core Web Vitals

Google 定义了三个核心用户体验指标：

| 指标 | 含义 | 良好阈值 |
|------|------|---------|
| LCP（Largest Contentful Paint） | 最大内容渲染时间 | ≤ 2.5s |
| INP（Interaction to Next Paint） | 交互响应延迟 | ≤ 200ms |
| CLS（Cumulative Layout Shift） | 累积布局偏移 | ≤ 0.1 |

### 用 web-vitals 库采集

```bash
npm install web-vitals
```

```ts title="src/monitor/performance.ts"
import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals'

export function initPerformanceMonitor() {
  const reportMetric = (metric: { name: string; value: number; rating: string }) => {
    report({
      type: 'web_vitals',
      name: metric.name,
      value: Math.round(metric.value),
      rating: metric.rating,  // 'good' | 'needs-improvement' | 'poor'
    })
  }

  onLCP(reportMetric)
  onINP(reportMetric)
  onCLS(reportMetric)
  onFCP(reportMetric)
  onTTFB(reportMetric)
}
```

### 自定义性能打点

页面关键路径的耗时用 `Performance.mark` 精确记录：

```ts
// 在关键节点打标记
performance.mark('data-fetch-start')
const data = await fetchPageData()
performance.mark('data-fetch-end')

performance.measure('data-fetch', 'data-fetch-start', 'data-fetch-end')

const [entry] = performance.getEntriesByName('data-fetch')
report({
  type: 'custom_timing',
  name: 'data-fetch',
  duration: Math.round(entry.duration),
})
```

### 接口耗时监控

拦截 fetch / XMLHttpRequest，自动记录每个接口的耗时和状态码：

```ts title="src/monitor/request.ts"
const originalFetch = window.fetch

window.fetch = async function (...args) {
  const url = typeof args[0] === 'string' ? args[0] : args[0].url
  const startTime = Date.now()

  try {
    const response = await originalFetch.apply(this, args)
    report({
      type: 'api_timing',
      url,
      duration: Date.now() - startTime,
      status: response.status,
    })
    return response
  } catch (e) {
    report({
      type: 'api_error',
      url,
      duration: Date.now() - startTime,
      message: String(e),
    })
    throw e
  }
}
```

---

## 三、行为数据采集

### 页面访问

```ts title="src/monitor/behavior.ts"
export function trackPageView() {
  report({
    type: 'page_view',
    url: location.href,
    referrer: document.referrer,
    title: document.title,
    timestamp: Date.now(),
  })
}

// SPA 路由变化时重新上报
// Vue Router
router.afterEach((to) => {
  trackPageView()
})
```

### 用户点击行为（声明式埋点）

命令式埋点需要侵入每个组件，声明式用 `data-track` 属性统一收集：

```html
<!-- ❌ 命令式：每个按钮都要单独绑定 -->
<button @click="() => { track('btn_click', { name: 'export' }); handleExport() }">
  导出
</button>

<!-- ✅ 声明式：统一监听，组件代码不受污染 -->
<button data-track="btn_click" data-track-name="export" @click="handleExport">
  导出
</button>
```

```ts
// 全局监听 data-track 属性的点击
document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest('[data-track]')
  if (!target) return

  const eventName = target.getAttribute('data-track')!
  const dataset = Object.fromEntries(
    [...target.attributes]
      .filter(attr => attr.name.startsWith('data-track-'))
      .map(attr => [attr.name.replace('data-track-', ''), attr.value]),
  )

  report({ type: 'user_action', event: eventName, ...dataset })
}, true)
```

---

## 四、上报策略

### 批量 + 延迟上报

每次操作都立即发请求会对服务端造成压力，正确做法是**本地队列 + 批量上报**：

```ts title="src/monitor/reporter.ts"
const queue: object[] = []
let timer: ReturnType<typeof setTimeout> | null = null

export function report(data: object) {
  queue.push({
    ...data,
    timestamp: Date.now(),
    url: location.href,
    ua: navigator.userAgent,
  })

  // 队列超过 20 条立即上报
  if (queue.length >= 20) {
    flush()
    return
  }

  // 否则延迟 3s 批量上报
  if (!timer) {
    timer = setTimeout(flush, 3000)
  }
}

function flush() {
  if (timer) { clearTimeout(timer); timer = null }
  if (queue.length === 0) return

  const batch = queue.splice(0)

  // 用 sendBeacon 保证页面卸载时数据不丢失
  navigator.sendBeacon('/api/monitor', JSON.stringify(batch))
}

// 页面卸载前强制上报
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
})
```

### 采样率控制

生产环境流量大时，全量上报成本高，对性能数据可以做采样：

```ts
const SAMPLE_RATE = 0.1  // 只上报 10%

export function reportWithSampling(data: object) {
  // 错误必须全量上报，不能采样
  if ((data as any).type?.includes('error')) {
    report(data)
    return
  }

  // 性能、行为数据按采样率上报
  if (Math.random() < SAMPLE_RATE) {
    report(data)
  }
}
```

---

## 五、自建 vs 接入 Sentry

| 维度 | 自建 | Sentry |
|------|------|--------|
| 接入成本 | 高（需开发上报 SDK + 后端服务） | 低（几行代码集成） |
| 数据安全 | 数据在自己服务器 | 数据在 Sentry 云端 |
| 功能完整性 | 按需定制 | 开箱即用（sourcemap、issue 分组、告警） |
| 维护成本 | 高（存储、查询、告警都要自己建） | 低 |
| 适合场景 | 数据合规要求高、有专职基础平台团队 | 大多数业务团队 |

**推荐大多数团队直接用 Sentry**，接入方式：

```bash
npm install @sentry/vue  # 或 @sentry/react
```

```ts title="src/main.ts"
import * as Sentry from '@sentry/vue'

Sentry.init({
  app,
  dsn: 'your-dsn-here',
  environment: import.meta.env.MODE,
  // 性能监控采样率
  tracesSampleRate: 0.1,
  // 只在生产环境开启
  enabled: import.meta.env.PROD,
})
```

---

## 总结

| 监控维度 | 捕获方式 | 上报时机 |
|---------|---------|---------|
| JS 运行时错误 | `window.onerror` + 框架 errorHandler | 立即上报 |
| Promise 异常 | `unhandledrejection` | 立即上报 |
| 资源加载失败 | 捕获阶段 `error` 事件 | 立即上报 |
| Core Web Vitals | `web-vitals` 库 | 页面隐藏时上报 |
| 接口耗时/错误 | 拦截 fetch / XHR | 批量上报 |
| 页面访问 | 路由钩子 | 批量上报 |
| 用户行为 | `data-track` 全局监听 | 批量上报 |

## 上线前检查清单

上线前确认以下监控点均已覆盖：

- [ ] JS 运行时错误（window.onerror）
- [ ] 未处理的 Promise rejection（unhandledrejection）
- [ ] 资源加载失败（捕获阶段 error 事件）
- [ ] 框架渲染错误（Vue errorHandler / React ErrorBoundary）
- [ ] Core Web Vitals（LCP / INP / CLS）
- [ ] 接口耗时与错误率
- [ ] 页面访问量（PV/UV）
- [ ] 上报采样率与批量策略已配置
- [ ] sourcemap 已上传（保证线上 stack trace 可读）
- [ ] 告警规则已配置（错误率超阈值时通知）
