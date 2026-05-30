---
title: "前端鉴权方案"
description: "从 Cookie/Session、JWT 到 OAuth2/OIDC，系统梳理前端鉴权的核心方案、Token 无感刷新实现与路由级别的权限控制"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: ""
tags: ["鉴权", "JWT", "OAuth2", "Cookie", "安全"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 前端鉴权方案

鉴权解决两个问题：**你是谁**（认证）和**你能做什么**（授权）。前端在这件事里的角色是：持有凭证、携带凭证发请求、处理凭证过期，以及根据权限控制界面。

方案选型的核心依据只有一个：**你的系统边界在哪里**。单体应用、微服务、第三方登录，每种场景下最优解不同。

---

## 一、Cookie / Session

### 原理

服务端创建 Session，把 Session ID 通过 `Set-Cookie` 写入浏览器，浏览器后续请求自动携带 Cookie，服务端凭 Session ID 查找用户状态。

```
登录请求 → 服务端创建 Session → Set-Cookie: sid=xxx
后续请求 → 浏览器自动带 Cookie: sid=xxx → 服务端查 Session → 验证通过
```

### 安全配置

```
Set-Cookie: sid=xxx; HttpOnly; Secure; SameSite=Strict; Max-Age=86400
```

| 属性 | 作用 |
|------|------|
| `HttpOnly` | JS 无法读取（防 XSS 窃取 Cookie） |
| `Secure` | 只在 HTTPS 下传输 |
| `SameSite=Strict` | 只在同源请求中携带（防 CSRF） |
| `SameSite=Lax` | 允许 GET 类型的跨站跳转携带（更宽松） |
| `Max-Age` | 有效期（秒），不设则为 Session Cookie（关闭浏览器失效） |

```ts
// ❌ 前端不要读 Cookie 里的 Session ID 做任何判断
// HttpOnly 使得 JS 根本读不到，这样做毫无意义
const sid = document.cookie.match(/sid=([^;]+)/)?.[1]
if (sid) { ... }

// ✅ Cookie/Session 模式下，前端只需要关心请求是否 401
// 服务端完全控制鉴权逻辑，前端不持有任何凭证
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      router.push('/login')
    }
    return Promise.reject(err)
  },
)
```

### 适用场景

- 同域单体应用（前后端同域）
- 对安全要求高的系统（银行、政务）
- 不需要跨域访问 API 的场景

---

## 二、JWT

### 结构

JWT 由三部分组成，Base64 编码后用 `.` 连接：

```
Header.Payload.Signature

eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMiLCJleHAiOjE3MDAwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

- **Header**：算法类型（`HS256` / `RS256`）
- **Payload**：用户信息 + 过期时间（明文，不要放敏感数据）
- **Signature**：用密钥对前两部分签名，防篡改

### 存储位置

```ts
// ❌ 方案一：localStorage（有 XSS 风险）
localStorage.setItem('token', jwt)
// JS 可以直接读取，XSS 攻击可以窃取 token

// ❌ 方案二：普通 Cookie（有 CSRF 风险）
// 浏览器自动携带，跨站请求也会带上

// ✅ 推荐：HttpOnly Cookie
// 服务端在登录响应里设置 HttpOnly Cookie，JS 读不到，XSS 无法窃取
// 配合 SameSite=Strict 防 CSRF
// 前端完全不需要管理 token，请求自动携带
```

如果必须用 `localStorage`（如跨域 API），至少做好 XSS 防护（CSP + 输出编码）。

### Payload 只放必要信息

```ts
// ❌ Payload 放了敏感数据，JWT 只是 Base64 编码，任何人都能解码
{
  userId: '123',
  password: 'hashed_password',  // 绝对不能放
  phone: '138xxxx',             // 敏感信息不能放
}

// ✅ 只放鉴权必需的最小字段
{
  sub: '123',        // 用户 ID
  role: 'admin',     // 角色
  exp: 1700000000,   // 过期时间（Unix 时间戳）
  iat: 1699999000,   // 签发时间
}
```

---

## 三、Token 无感刷新

Access Token 有效期短（15 分钟到 2 小时），过期后需要用 Refresh Token 换新的 Access Token，这个过程对用户应该是无感的。

### 核心问题

并发请求时，多个请求同时遇到 401，会同时触发刷新，导致竞争和重复刷新。解决方案是**刷新时挂起后续请求，刷新完成后统一重发**。

```ts title="src/utils/request.ts"
import axios from 'axios'

const http = axios.create({ baseURL: '/api' })

let isRefreshing = false
// 刷新期间挂起的请求队列
const pendingQueue: Array<(token: string) => void> = []

http.interceptors.response.use(
  res => res,
  async err => {
    const originalRequest = err.config

    if (err.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(err)
    }

    if (isRefreshing) {
      // 刷新进行中：把当前请求加入等待队列
      return new Promise(resolve => {
        pendingQueue.push((newToken: string) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`
          resolve(http(originalRequest))
        })
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const { data } = await http.post('/auth/refresh', {
        refreshToken: getRefreshToken(),
      })
      const newToken = data.accessToken

      saveToken(newToken)

      // 通知队列里所有挂起的请求
      pendingQueue.forEach(resolve => resolve(newToken))
      pendingQueue.length = 0

      // 重发原始请求
      originalRequest.headers.Authorization = `Bearer ${newToken}`
      return http(originalRequest)
    } catch {
      // 刷新也失败，强制登出
      clearToken()
      router.push('/login')
      return Promise.reject(err)
    } finally {
      isRefreshing = false
    }
  },
)
```

---

## 四、OAuth2 / OIDC

### 适用场景

- 接入第三方登录（GitHub、Google、微信）
- 微服务架构，多个服务共享一个认证中心
- 需要授权第三方应用访问用户数据

### Authorization Code + PKCE 流程

PKCE（Proof Key for Code Exchange）是 OAuth2 在前端（公开客户端）的安全扩展，防止授权码被截获：

```ts title="src/utils/oauth.ts"
// 1. 生成 code_verifier（随机字符串）和 code_challenge（其 SHA256 哈希）
async function generatePKCE() {
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')

  sessionStorage.setItem('pkce_verifier', verifier)
  return { verifier, challenge }
}

// 2. 跳转到授权页
async function startLogin() {
  const { challenge } = await generatePKCE()
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauth_state', state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'your-client-id',
    redirect_uri: `${location.origin}/callback`,
    scope: 'openid profile email',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  location.href = `https://auth.example.com/authorize?${params}`
}

// 3. 回调页处理 code，换取 token
async function handleCallback() {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const state = params.get('state')

  // 验证 state 防止 CSRF
  if (state !== sessionStorage.getItem('oauth_state')) {
    throw new Error('Invalid state')
  }

  const verifier = sessionStorage.getItem('pkce_verifier')!

  const { data } = await axios.post('https://auth.example.com/token', {
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${location.origin}/callback`,
    client_id: 'your-client-id',
    code_verifier: verifier,
  })

  saveToken(data.access_token)
  router.push('/')
}
```

---

## 五、权限控制

### 路由级别：导航守卫

```ts title="src/router/index.ts"
router.beforeEach((to, _from, next) => {
  const isLoggedIn = !!getToken()
  const requiresAuth = to.meta.requiresAuth

  if (requiresAuth && !isLoggedIn) {
    next({ path: '/login', query: { redirect: to.fullPath } })
    return
  }

  // 角色权限：页面需要 admin，但当前用户不是 admin
  const requiredRole = to.meta.role as string | undefined
  const userRole = useAuthStore().role

  if (requiredRole && userRole !== requiredRole) {
    next('/403')
    return
  }

  next()
})
```

路由配置：

```ts
const routes = [
  {
    path: '/dashboard',
    component: Dashboard,
    meta: { requiresAuth: true },
  },
  {
    path: '/admin',
    component: AdminPanel,
    meta: { requiresAuth: true, role: 'admin' },
  },
]
```

### 按钮级别：自定义指令

```ts title="src/directives/permission.ts"
import type { Directive } from 'vue'
import { useAuthStore } from '@/stores/auth'

// 用法：v-permission="'user:delete'"
export const vPermission: Directive<HTMLElement, string> = {
  mounted(el, binding) {
    const authStore = useAuthStore()
    const required = binding.value

    if (!authStore.permissions.includes(required)) {
      // 没权限：移除元素
      el.parentNode?.removeChild(el)
    }
  },
}
```

```html
<button v-permission="'order:export'">导出订单</button>
<button v-permission="'user:delete'">删除用户</button>
```

---

## 方案对比

| 维度 | Cookie/Session | JWT | OAuth2/OIDC |
|------|---------------|-----|-------------|
| 状态管理 | 服务端有状态 | 无状态 | 无状态 |
| 跨域支持 | 较差（需 CORS + withCredentials） | 好（Header 携带） | 好 |
| Token 撤销 | 直接删 Session | 需要黑名单或短有效期 | 通过授权服务器撤销 |
| 适合场景 | 同域单体应用 | 前后端分离、移动端 | 第三方登录、多服务共享认证 |
| 安全重点 | SameSite + HttpOnly | 存储位置 + 短有效期 | PKCE + state 防 CSRF |
