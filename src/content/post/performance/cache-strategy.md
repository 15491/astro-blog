---
title: "前端缓存策略"
description: "从 HTTP 强缓存、协商缓存到 Service Worker 离线缓存，系统梳理前端缓存体系的分层设计、构建产物缓存策略与内存缓存实现"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: ""
tags: ["缓存", "HTTP", "Service Worker", "性能优化", "工程实践"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 前端缓存策略

缓存是性能优化里收益最高的手段，但也是最容易踩坑的地方——缓存没生效，用户每次都重新下载；缓存太激进，用户看到的是旧版本。

理解缓存的关键是**分层**：HTTP 缓存在网络层、Service Worker 在浏览器层、内存缓存在运行时层。每一层解决的问题不同，配合起来才能发挥最大效果。

---

## 一、HTTP 缓存：强缓存与协商缓存

### 强缓存

浏览器直接用本地缓存，**不发请求**。通过响应头控制：

```
Cache-Control: max-age=31536000, immutable
```

| 字段 | 含义 |
|------|------|
| `max-age=N` | N 秒内直接用缓存，不发请求 |
| `immutable` | 文件内容永远不变，即使用户强制刷新也不重验证 |
| `no-cache` | 每次必须向服务端验证（不是"不缓存"） |
| `no-store` | 真正不缓存，每次都下载 |
| `private` | 只允许浏览器缓存，不允许 CDN 缓存 |
| `public` | 允许 CDN 等中间代理缓存 |

### 协商缓存

浏览器发请求，**服务端判断文件是否变化**，没变化返回 304（不传文件内容），变化了返回 200 + 新文件。

两种机制：

```
# 基于时间（精度低，精确到秒）
Last-Modified: Wed, 21 Oct 2024 07:28:00 GMT
If-Modified-Since: Wed, 21 Oct 2024 07:28:00 GMT

# 基于内容哈希（推荐，更精确）
ETag: "abc123"
If-None-Match: "abc123"
```

### 两者的配合

```
强缓存命中 → 直接用本地文件（0 网络请求）
    ↓ 过期
协商缓存 → 发请求验证
    ↓ 未变化
304 → 继续用本地文件（只有请求头，无响应体）
    ↓ 已变化
200 → 下载新文件
```

---

## 二、构建产物的缓存策略

### 核心原则：index.html 不缓存，静态资源永久缓存

```
# ❌ index.html 设了长缓存，新版本部署后用户看不到更新
Cache-Control: max-age=31536000  ← index.html 不能这样配

# ✅ 正确分层
index.html         → Cache-Control: no-cache（每次验证）
main.abc123.js     → Cache-Control: max-age=31536000, immutable
style.def456.css   → Cache-Control: max-age=31536000, immutable
```

原因：`index.html` 引用带 hash 的资源文件。部署新版本时 hash 变了，`index.html` 更新，浏览器重新下载新的 JS/CSS。如果 `index.html` 也被缓存，用户永远看到的是旧的引用。

### Vite 的 hash 配置

Vite 默认对输出文件名加 hash，生产环境开箱即用：

```ts title="vite.config.ts"
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // JS 文件：内容 hash
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        // CSS 文件：内容 hash
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
    },
  },
})
```

### Nginx 配置对应

```nginx
server {
  # index.html：不缓存
  location = /index.html {
    add_header Cache-Control "no-cache";
  }

  # 带 hash 的静态资源：永久缓存
  location /assets/ {
    add_header Cache-Control "max-age=31536000, immutable";
  }
}
```

---

## 三、Service Worker 离线缓存

Service Worker 运行在独立线程，可以拦截所有网络请求，实现离线访问和更精细的缓存控制。

### 三种核心策略

**Cache First（缓存优先）**：适合不常变化的静态资源

```ts
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      // 有缓存直接返回，不发网络请求
      return cached ?? fetch(event.request)
    })
  )
})
```

**Network First（网络优先）**：适合需要实时数据的接口

```ts
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 网络成功：更新缓存并返回
        const clone = response.clone()
        caches.open('api-cache').then(cache => cache.put(event.request, clone))
        return response
      })
      .catch(() => {
        // 网络失败：降级到缓存
        return caches.match(event.request)
      })
  )
})
```

**Stale-While-Revalidate（返回缓存同时后台刷新）**：适合对实时性要求不高但希望响应快的场景

```ts
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.open('sw-cache').then(cache =>
      cache.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          cache.put(event.request, response.clone())
          return response
        })
        // 有缓存立即返回，同时后台刷新
        return cached ?? networkFetch
      })
    )
  )
})
```

### 用 Workbox 简化配置

手写 Service Worker 容易出错，生产环境推荐 Workbox：

```bash
npm install -D vite-plugin-pwa
```

```ts title="vite.config.ts"
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      workbox: {
        // 静态资源用 Cache First
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // 接口用 Network First
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.example\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],
})
```

---

## 四、内存缓存：LRU 实现

对于计算成本高或请求频繁的数据，在内存里做 LRU（最近最少使用）缓存：

```ts title="src/utils/lru-cache.ts"
class LRUCache<K, V> {
  private capacity: number
  private cache: Map<K, V>

  constructor(capacity: number) {
    this.capacity = capacity
    // Map 会记录插入顺序，天然支持 LRU
    this.cache = new Map()
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined
    // 访问时移到末尾（最近使用）
    const value = this.cache.get(key)!
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.capacity) {
      // 删除最久未使用的（Map 的第一个元素）
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }
}

// 使用示例：缓存接口结果
const apiCache = new LRUCache<string, unknown>(50)

async function fetchWithCache<T>(url: string): Promise<T> {
  if (apiCache.has(url)) {
    return apiCache.get(url) as T
  }
  const data = await fetch(url).then(r => r.json())
  apiCache.set(url, data)
  return data
}
```

---

## 五、浏览器存储方案对比

| 存储方式 | 容量 | 生命周期 | 同步/异步 | 适用场景 |
|---------|------|---------|---------|---------|
| `localStorage` | ~5MB | 永久 | 同步 | 用户设置、主题偏好 |
| `sessionStorage` | ~5MB | 标签页关闭 | 同步 | 临时表单数据、页面状态 |
| `Cookie` | ~4KB | 可设置过期时间 | 同步 | 鉴权 Token、服务端读取 |
| `IndexedDB` | 无硬性限制 | 永久 | 异步 | 大量结构化数据、离线数据 |
| `Cache API` | 无硬性限制 | 永久 | 异步 | Service Worker 缓存响应 |

### localStorage 的常见错误

```ts
// ❌ 直接存对象，取出来是 "[object Object]"
localStorage.setItem('user', user)

// ❌ 不处理 JSON 解析错误，数据损坏时整页崩溃
const user = JSON.parse(localStorage.getItem('user'))

// ✅ 封装读写，处理序列化和错误
function setStorage<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function getStorage<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : defaultValue
  } catch {
    return defaultValue
  }
}
```

---

## 缓存策略选择矩阵

| 资源类型 | 推荐策略 | 原因 |
|---------|---------|------|
| `index.html` | `no-cache`（协商缓存） | 必须能及时更新，引导加载新 hash 资源 |
| JS / CSS（带 hash） | `max-age=31536000, immutable` | hash 变了就是新文件，可以永久缓存 |
| 图片 / 字体（带 hash） | `max-age=31536000, immutable` | 同上 |
| API 接口（实时数据） | Network First（SW） | 优先获取最新，网络故障时降级 |
| API 接口（相对静态） | Stale-While-Revalidate | 快速响应，后台更新 |
| 用户设置 | `localStorage` | 持久化，体积小 |
| 大量离线数据 | `IndexedDB` | 异步、容量大 |
| 高频计算结果 | 内存 LRU | 最快，但刷新后消失 |
