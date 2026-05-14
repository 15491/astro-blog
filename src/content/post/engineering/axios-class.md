---
title: "Axios 封装实践：基于类的 TypeScript 方案"
description: "用 TypeScript 将 axios 封装成类，覆盖拦截器、统一错误处理、请求取消、重试机制、全局 Loading、Token 无感刷新、类型安全的 API 层设计"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["axios", "TypeScript", "封装", "HTTP", "请求"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Axios 封装实践：基于类的 TypeScript 方案

直接用 axios 的问题不是功能不够，而是**重复代码太多**：每个请求都要处理 token、每个响应都要判断 code、每个错误都要 catch 一遍。封装的目的是把这些横切关注点收拢到一处，让业务代码只关心数据。

## 目标

封装完成后，业务层的调用应该长这样：

```ts
// 泛型约束返回类型，不需要手动断言
const user = await userApi.getById(1)          // User
const list = await userApi.getList({ page: 1 }) // { list: User[]; total: number }

// 错误已经在封装层统一处理，业务层不用每次 try/catch
```

---

## 基础类结构

```ts title="src/http/request.ts"
import axios from 'axios'
import type {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'

// 后端统一响应结构
interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

export class Request {
  private instance: AxiosInstance

  constructor(config: AxiosRequestConfig) {
    this.instance = axios.create(config)
    this.setupInterceptors()
  }

  private setupInterceptors() {
    this.setupRequestInterceptor()
    this.setupResponseInterceptor()
  }

  private setupRequestInterceptor() {
    this.instance.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => config,
      (error) => Promise.reject(error),
    )
  }

  private setupResponseInterceptor() {
    this.instance.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error) => Promise.reject(error),
    )
  }

  // 对外暴露的请求方法，后续章节逐步完善
  request<T>(config: AxiosRequestConfig): Promise<T> {
    return this.instance.request<ApiResponse<T>>(config).then(res => res.data.data)
  }

  get<T>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'GET', url, params })
  }

  post<T>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'POST', url, data })
  }

  put<T>(url: string, data?: object, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'PUT', url, data })
  }

  delete<T>(url: string, params?: object, config?: AxiosRequestConfig): Promise<T> {
    return this.request<T>({ ...config, method: 'DELETE', url, params })
  }
}
```

---

## 请求拦截器

### 自动注入 Token

```ts title="src/http/request.ts" {7,8,9}
private setupRequestInterceptor() {
  this.instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      const token = localStorage.getItem('token')
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    },
    (error) => Promise.reject(error),
  )
}
```

### 支持自定义请求头

有时候某个接口需要特殊的请求头，通过 config 透传即可：

```ts
// 上传文件时覆盖 Content-Type
http.post('/upload', formData, {
  headers: { 'Content-Type': 'multipart/form-data' },
})
```

拦截器里的 `config.headers` 合并规则由 axios 内部处理，手动设置的优先级更高，不会被拦截器覆盖。

---

## 响应拦截器

后端通常有一套统一的响应结构，比如 `{ code, message, data }`。响应拦截器负责解包数据、识别业务错误：

```ts title="src/http/request.ts"
private setupResponseInterceptor() {
  this.instance.interceptors.response.use(
    (response: AxiosResponse<ApiResponse>) => {
      const { code, message, data } = response.data

      // HTTP 200 但业务层失败
      if (code !== 0) {
        // 特殊 code 统一处理
        if (code === 401) {
          this.handleUnauthorized()
          return Promise.reject(new Error(message))
        }
        if (code === 403) {
          window.location.href = '/403'
          return Promise.reject(new Error(message))
        }
        // 其他业务错误，统一 toast 提示
        showToast(message)
        return Promise.reject(new Error(message))
      }

      return data  // 直接返回 data，调用方拿到的就是业务数据
    },
    (error) => {
      // HTTP 层错误（网络断开、超时、4xx/5xx）
      this.handleHttpError(error)
      return Promise.reject(error)
    },
  )
}

private handleUnauthorized() {
  localStorage.removeItem('token')
  window.location.href = `/login?redirect=${encodeURIComponent(location.pathname)}`
}

private handleHttpError(error: unknown) {
  if (!axios.isAxiosError(error)) return

  const statusMessages: Record<number, string> = {
    400: '请求参数错误',
    404: '请求的资源不存在',
    500: '服务器内部错误',
    502: '网关错误',
    503: '服务暂时不可用',
  }

  const status = error.response?.status
  const message = (status && statusMessages[status]) ?? '网络请求失败'

  if (error.code === 'ECONNABORTED') {
    showToast('请求超时，请稍后重试')
  } else if (!navigator.onLine) {
    showToast('当前网络不可用，请检查网络连接')
  } else {
    showToast(message)
  }
}
```

:::note[响应拦截器的返回值]
`response.use` 的成功回调里，返回什么，后续 `.then` 就收到什么。这里返回 `data`（业务数据），所以 `request<T>` 方法里不再需要 `.then(res => res.data.data)`，可以直接透传。后文的 `request` 方法会相应调整。
:::

调整后的 `request` 方法：

```ts
request<T>(config: AxiosRequestConfig): Promise<T> {
  // 响应拦截器已经解包了 data，这里直接拿结果
  return this.instance.request<T, T>(config)
}
```

---

## 请求取消

页面切换时，上一个页面发出的请求如果还没返回，可能会操作已卸载组件的状态，造成内存泄漏或报错。`AbortController` 可以取消进行中的请求：

```ts title="src/http/request.ts"
export class Request {
  private instance: AxiosInstance
  // 存储所有进行中的请求，key 是请求标识
  private pendingMap = new Map<string, AbortController>()

  private getRequestKey(config: AxiosRequestConfig): string {
    const { method = 'GET', url, params, data } = config
    return [method, url, JSON.stringify(params), JSON.stringify(data)].join('&')
  }

  private addPending(config: AxiosRequestConfig & { signal?: AbortSignal }) {
    const key = this.getRequestKey(config)
    if (this.pendingMap.has(key)) {
      // 相同请求已在进行中，取消上一个（防重复提交）
      this.pendingMap.get(key)!.abort()
    }
    const controller = new AbortController()
    config.signal = controller.signal
    this.pendingMap.set(key, controller)
  }

  private removePending(config: AxiosRequestConfig) {
    const key = this.getRequestKey(config)
    this.pendingMap.delete(key)
  }

  // 取消所有进行中的请求（页面切换时调用）
  cancelAll() {
    this.pendingMap.forEach(controller => controller.abort())
    this.pendingMap.clear()
  }
}
```

在拦截器里接入：

```ts
private setupRequestInterceptor() {
  this.instance.interceptors.request.use((config) => {
    this.addPending(config)
    // ... token 注入
    return config
  })
}

private setupResponseInterceptor() {
  this.instance.interceptors.response.use(
    (response) => {
      this.removePending(response.config)
      // ... 业务逻辑
    },
    (error) => {
      if (error.config) this.removePending(error.config)
      if (axios.isCancel(error)) return Promise.reject(error)  // 取消不需要 toast
      this.handleHttpError(error)
      return Promise.reject(error)
    },
  )
}
```

在 Vue 组件里结合 `onUnmounted` 使用：

```ts
import { onUnmounted } from 'vue'

onUnmounted(() => {
  http.cancelAll()
})
```

---

## 重试机制

对于幂等请求（GET），网络抖动时自动重试可以提升用户体验：

```ts title="src/http/request.ts"
// 扩展 axios 配置类型，加入自定义字段
declare module 'axios' {
  interface AxiosRequestConfig {
    retry?: number            // 最大重试次数，默认 0
    retryDelay?: number       // 重试间隔（ms），默认 1000
    __retryCount?: number     // 内部计数，不需要外部传
    loading?: boolean         // 是否显示全局 loading，默认 true
    _isRetryRequest?: boolean // 内部标记，已重发的请求不再触发 token 刷新
  }
}

private setupResponseInterceptor() {
  this.instance.interceptors.response.use(
    undefined,  // 成功不处理
    async (error) => {
      const config = error.config as AxiosRequestConfig

      // 没有配置重试，或已达到上限
      if (!config?.retry || (config.__retryCount ?? 0) >= config.retry) {
        this.handleHttpError(error)
        return Promise.reject(error)
      }

      // 只对网络错误/超时重试，服务端主动返回的错误（4xx）不重试
      const shouldRetry = !error.response || error.code === 'ECONNABORTED'
      if (!shouldRetry) {
        this.handleHttpError(error)
        return Promise.reject(error)
      }

      config.__retryCount = (config.__retryCount ?? 0) + 1

      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, config.retryDelay ?? 1000))
      return this.instance.request(config)
    },
  )
}
```

使用时在 config 里指定重试次数：

```ts
// 最多重试 3 次，每次间隔 1s
http.get('/api/config', {}, { retry: 3, retryDelay: 1000 })
```

---

## 全局 Loading 状态

多个请求并发时，需要一个计数器来决定什么时候显示、什么时候隐藏 loading，而不是每个请求单独控制。

### 请求计数器

```ts title="src/http/request.ts"
export class Request {
  private loadingCount = 0
  private loadingInstance: ReturnType<typeof ElLoading.service> | null = null

  private showLoading() {
    if (this.loadingCount === 0) {
      this.loadingInstance = ElLoading.service({
        fullscreen: true,
        text: '加载中...',
      })
    }
    this.loadingCount++
  }

  private hideLoading() {
    this.loadingCount = Math.max(0, this.loadingCount - 1)
    if (this.loadingCount === 0) {
      this.loadingInstance?.close()
      this.loadingInstance = null
    }
  }
}
```

在拦截器里接入，请求开始时 +1，结束时 -1（成功和失败都要减）：

```ts
private setupRequestInterceptor() {
  this.instance.interceptors.request.use((config) => {
    if (config.loading !== false) this.showLoading()
    // ... token 注入
    return config
  })
}

private setupResponseInterceptor() {
  this.instance.interceptors.response.use(
    (response) => {
      if (response.config.loading !== false) this.hideLoading()
      // ... 其他逻辑
      return response.data
    },
    (error) => {
      if (error.config?.loading !== false) this.hideLoading()
      // ... 其他逻辑
      return Promise.reject(error)
    },
  )
}
```

### 按需关闭

默认所有请求都显示全屏 loading。对于轮询、后台静默请求，传 `loading: false` 关闭：

```ts
// 5 秒轮询状态，不需要遮罩
setInterval(() => http.get('/api/status', {}, { loading: false }), 5000)

// 普通接口，默认显示 loading
http.get('/api/users')
```

:::warning[hideLoading 必须做防御判断]
请求被取消时 `error.config` 可能为 `null`，需要用 `error.config?.loading` 安全访问，否则计数器失衡，loading 会一直显示无法关闭。
:::

---

## Token 无感刷新

Access Token 有效期通常较短（1 小时左右）。过期时如果直接跳登录页，用户正在填写的表单就丢失了，体验很差。无感刷新的思路是：**拦截 401 → 用 Refresh Token 换新 Token → 用新 Token 重发原请求**，整个过程用户无感知。

### 并发 401 的问题

Token 过期时，页面上往往有多个请求同时发出，它们会同时收到 401。如果每个 401 都去调刷新接口，会发起多次刷新——第一次刷新后 Refresh Token 就失效了，后续的刷新全部失败。

解决方法是用标志位 `isRefreshing` 保证只有一次刷新在进行，其他 401 排队等待结果：

```
请求 A ──► 401 ──► isRefreshing=false → 发起刷新
请求 B ──► 401 ──► isRefreshing=true  → 进入队列等待
请求 C ──► 401 ──► isRefreshing=true  → 进入队列等待

刷新成功 → 新 token → 通知队列 → A、B、C 用新 token 重发
刷新失败 → 通知队列全部拒绝 → 跳登录页
```

### 实现

```ts title="src/http/request.ts"
export class Request {
  private isRefreshing = false
  // 刷新期间排队的请求，token 有值则重发，空字符串则拒绝
  private refreshQueue: Array<(token: string) => void> = []

  private async doRefreshToken(): Promise<string> {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) throw new Error('no refresh token')
    // 直接用原始 axios，绕过拦截器（避免递归触发 401 处理）
    const res = await axios.post('/auth/refresh', { refreshToken })
    return res.data.data.accessToken
  }

  private setupResponseInterceptor() {
    this.instance.interceptors.response.use(
      undefined,
      async (error) => {
        const originalConfig = error.config

        // 401 且不是刷新接口本身（_isRetryRequest 防止死循环）
        if (error.response?.status === 401 && !originalConfig?._isRetryRequest) {

          if (!this.isRefreshing) {
            this.isRefreshing = true
            try {
              const newToken = await this.doRefreshToken()
              localStorage.setItem('token', newToken)

              // 通知排队的请求用新 token 重发
              this.refreshQueue.forEach(cb => cb(newToken))
              this.refreshQueue = []

              // 重发触发 401 的原请求
              originalConfig.headers.Authorization = `Bearer ${newToken}`
              originalConfig._isRetryRequest = true
              return this.instance.request(originalConfig)
            } catch {
              // refreshToken 也过期了，通知队列全部失败，跳登录
              this.refreshQueue.forEach(cb => cb(''))
              this.refreshQueue = []
              this.handleUnauthorized()
              return Promise.reject(error)
            } finally {
              this.isRefreshing = false
            }
          }

          // 刷新进行中，当前请求进队列等结果
          return new Promise((resolve, reject) => {
            this.refreshQueue.push((token: string) => {
              if (!token) return reject(error)
              originalConfig.headers.Authorization = `Bearer ${token}`
              originalConfig._isRetryRequest = true
              resolve(this.instance.request(originalConfig))
            })
          })
        }

        // 非 401 走正常错误处理
        this.handleHttpError(error)
        return Promise.reject(error)
      },
    )
  }
}
```

:::note[_isRetryRequest 的作用]
重发的请求如果再次收到 401（比如新 token 颁发有问题），不能再次触发刷新，否则死循环。`_isRetryRequest = true` 让拦截器识别并跳过这些请求，直接走正常错误处理。
:::

:::tip[doRefreshToken 为什么用原始 axios]
刷新接口不需要带旧 Access Token，带了反而会被后端拒绝。更重要的是，用 `this.instance` 发刷新请求，一旦刷新也返回 401，会再次进入这段逻辑，造成递归。直接用裸 `axios` 可以彻底绕开自定义拦截器。
:::

---

## 类型安全的 API 层

封装好基础 `Request` 类之后，在它之上再封装一层 API 模块，把 URL 和类型绑定在一起：

```ts title="src/api/types/user.ts"
export interface User {
  id: number
  name: string
  email: string
  role: 'admin' | 'user'
  createdAt: string
}

export interface UserListParams {
  page: number
  pageSize?: number
  keyword?: string
  role?: User['role']
}

export interface UserListResult {
  list: User[]
  total: number
  page: number
  pageSize: number
}

export interface CreateUserPayload {
  name: string
  email: string
  role: User['role']
}
```

```ts title="src/api/user.ts"
import { http } from '@/http'
import type { User, UserListParams, UserListResult, CreateUserPayload } from './types/user'

export const userApi = {
  getList(params: UserListParams) {
    return http.get<UserListResult>('/users', params)
  },

  getById(id: number) {
    return http.get<User>(`/users/${id}`)
  },

  create(payload: CreateUserPayload) {
    return http.post<User>('/users', payload)
  },

  update(id: number, payload: Partial<CreateUserPayload>) {
    return http.put<User>(`/users/${id}`, payload)
  },

  remove(id: number) {
    return http.delete<void>(`/users/${id}`)
  },
}
```

业务组件里调用：

```ts title="views/UserList.vue"
import { userApi } from '@/api/user'

const { list, total } = await userApi.getList({ page: 1, pageSize: 20 })
// list 的类型是 User[]，total 是 number，全部有 IDE 提示
```

:::tip[API 模块不要用 class]
`userApi` 用普通对象而不是类，是因为它本身没有状态。状态（axios 实例、配置）在 `Request` 类里。用对象字面量更简洁，也方便 Tree Shaking——只 import 了 `getList`，`create` 等方法的代码不会被打进 Bundle。
:::

---

## 实例化与导出

一个项目通常只需要一个 axios 实例：

```ts title="src/http/index.ts"
import { Request } from './request'

export const http = new Request({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})
```

如果项目同时对接多个后端服务，可以创建多个实例：

```ts title="src/http/index.ts"
// 主业务服务
export const http = new Request({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 10000,
})

// 第三方数据服务（不同的鉴权方式）
export const dataHttp = new Request({
  baseURL: import.meta.env.VITE_DATA_API_URL,
  timeout: 30000,
})
```

---

## 完整文件结构

```
src/
├── http/
│   ├── request.ts    # Request 类核心实现
│   └── index.ts      # 实例化并导出
└── api/
    ├── types/
    │   ├── user.ts   # User 相关类型
    │   └── order.ts  # Order 相关类型
    ├── user.ts       # userApi
    └── order.ts      # orderApi
```

---

## 小结

| 层 | 职责 |
|----|------|
| `Request` 类 | axios 实例管理、拦截器、错误处理、取消、重试、全局 Loading、Token 无感刷新 |
| `http` 实例 | 单例导出，全局共用一份配置 |
| `api/types/` | 各模块的请求/响应类型定义 |
| `api/*.ts` | 将 URL、类型、参数绑定在一起，业务层直接调用 |

封装的分层逻辑是：**越底层越通用，越上层越具体**。`Request` 类不知道业务，`userApi` 只知道用户接口，业务组件只知道数据。每层只做自己分内的事，改动时影响范围最小。
