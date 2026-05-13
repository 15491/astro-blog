---
title: "请求方式"
description: "常见的请求方式，如xhr、fetch、sse、sendBeacon、socket"
publishDate: "2025-09-24T08:30:00.000Z"
updatedDate: "2025-09-30T06:29:36.014Z"
tags: ["网络", "xhr", "fetch", "sse", "sendBeacon", "socket"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 请求的方式

## xhr

[`XMLHttpRequest`](https://developer.mozilla.org/zh-CN/docs/Web/API/XMLHttpRequest)（XHR）是一种创建 [HTTP](https://developer.mozilla.org/zh-CN/docs/Glossary/HTTP) 请求的 [JavaScript](https://developer.mozilla.org/zh-CN/docs/Glossary/JavaScript) [API](https://developer.mozilla.org/zh-CN/docs/Glossary/API)。它的方法提供了在[浏览器](https://developer.mozilla.org/zh-CN/docs/Glossary/Browser)和[服务器](https://developer.mozilla.org/zh-CN/docs/Glossary/Server)之间发送请求的能力。

### 基本用法

```js
const xhr = new XMLHttpRequest()

// open(method, url, async)
xhr.open('GET', '/api/data', true)

xhr.onload = function () {
  if (xhr.status >= 200 && xhr.status < 300) {
    const data = JSON.parse(xhr.responseText)
    console.log(data)
  }
}

xhr.onerror = function () {
  console.error('请求失败')
}

xhr.send()
```

POST 请求发送 JSON：

```js
const xhr = new XMLHttpRequest()
xhr.open('POST', '/api/user', true)
xhr.setRequestHeader('Content-Type', 'application/json')

xhr.onload = function () {
  console.log(JSON.parse(xhr.responseText))
}

xhr.send(JSON.stringify({ name: 'Alice', age: 18 }))
```

### 常用属性与事件

| 属性 / 事件 | 说明 |
| --- | --- |
| `readyState` | 请求状态（0~4） |
| `status` | HTTP 状态码 |
| `responseText` | 响应文本 |
| `response` | 响应体（类型由 `responseType` 决定） |
| `onload` | 请求成功完成时触发 |
| `onerror` | 网络错误时触发 |
| `onprogress` | 接收数据过程中周期触发 |
| `ontimeout` | 超时时触发 |

**readyState 的值：**

| 值 | 状态 | 说明 |
| --- | --- | --- |
| 0 | UNSENT | 尚未调用 `open()` |
| 1 | OPENED | 已调用 `open()` |
| 2 | HEADERS_RECEIVED | 已收到响应头 |
| 3 | LOADING | 正在接收响应体 |
| 4 | DONE | 请求完成 |

### responseType

设置 `responseType` 后，直接从 `xhr.response` 获取已解析的数据，无需手动转换：

```js
const xhr = new XMLHttpRequest()
xhr.open('GET', '/api/data', true)
xhr.responseType = 'json' // '' | 'text' | 'json' | 'blob' | 'arraybuffer' | 'document'

xhr.onload = function () {
  console.log(xhr.response) // 已自动解析为对象，无需 JSON.parse
}

xhr.send()
```

下载文件（二进制）：

```js
xhr.responseType = 'blob'

xhr.onload = function () {
  const url = URL.createObjectURL(xhr.response)
  const a = document.createElement('a')
  a.href = url
  a.download = 'file.png'
  a.click()
  URL.revokeObjectURL(url)
}
```

### 跨域携带 Cookie

跨域请求默认不携带 Cookie，需将 `withCredentials` 设为 `true`，同时服务端响应头须包含 `Access-Control-Allow-Credentials: true`：

```js
xhr.withCredentials = true
```

### 设置请求头

```js
xhr.setRequestHeader('Authorization', 'Bearer token123')
xhr.setRequestHeader('Content-Type', 'application/json')
```

### 超时设置

```js
xhr.timeout = 5000 // 5秒超时

xhr.ontimeout = function () {
  console.warn('请求超时')
}
```

### 监听上传进度

```js
xhr.upload.onprogress = function (e) {
  if (e.lengthComputable) {
    const percent = (e.loaded / e.total) * 100
    console.log(`上传进度：${percent.toFixed(1)}%`)
  }
}
```

### 取消请求

调用 `abort()` 可以中止正在进行的请求，触发 `onabort` 事件。

```js
const xhr = new XMLHttpRequest()
xhr.open('GET', '/api/data', true)

xhr.onabort = function () {
  console.log('请求已取消')
}

xhr.send()

// 需要取消时
xhr.abort()
```

---

## fetch

[`fetch`](https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API) 是基于 Promise 的现代网络请求 API，语法更简洁，天然支持 `async/await`。

### 基本用法

```js
// GET
const res = await fetch('/api/data')
const data = await res.json()

// POST
const res = await fetch('/api/user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Alice' }),
})
const data = await res.json()
```

### 常用配置项

```js
fetch(url, {
  method: 'POST',           // 请求方法
  headers: {},              // 请求头
  body: '',                 // 请求体
  mode: 'cors',             // cors | no-cors | same-origin
  credentials: 'include',  // omit | same-origin | include（携带 cookie）
  cache: 'no-cache',        // 缓存策略
  redirect: 'follow',       // follow | error | manual
  signal: controller.signal // AbortController 信号
})
```

### 响应处理

`fetch` 只有在网络故障时才 reject，HTTP 错误（4xx/5xx）不会 reject，需手动判断 `res.ok`。

```js
const res = await fetch('/api/data')

if (!res.ok) {
  throw new Error(`HTTP 错误：${res.status}`)
}

// 根据响应类型选择解析方式
const json = await res.json()     // JSON
const text = await res.text()     // 纯文本
const blob = await res.blob()     // 二进制（图片/文件）
const form = await res.formData() // FormData
```

### 取消请求

使用 `AbortController` 取消 fetch 请求：

```js
const controller = new AbortController()

fetch('/api/data', { signal: controller.signal })
  .then(res => res.json())
  .then(console.log)
  .catch(err => {
    if (err.name === 'AbortError') {
      console.log('请求已取消')
    }
  })

// 需要取消时
controller.abort()
```

超时自动取消：

```js
function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)

  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer)
  })
}
```

### 上传文件

```js
const formData = new FormData()
formData.append('file', fileInput.files[0])

await fetch('/api/upload', {
  method: 'POST',
  body: formData, // 不需要手动设置 Content-Type，浏览器会自动加 boundary
})
```

### 流式响应

对于 AI 对话、实时日志等场景，服务端会持续分块推送数据。`fetch` 通过 `res.body`（`ReadableStream`）逐块读取，无需等待响应完整返回：

```js
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'hello' }),
})

const reader = res.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  const chunk = decoder.decode(value, { stream: true })
  console.log(chunk) // 每次输出一小段文字
}
```

配合 `AbortController` 中途打断流：

```js
const controller = new AbortController()

const res = await fetch('/api/chat', { signal: controller.signal })
const reader = res.body.getReader()

// 用户点击"停止"
stopBtn.onclick = () => controller.abort()
```

---

## SSE

[`Server-Sent Events`](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events)（SSE）允许服务端通过 HTTP 持续向客户端推送数据，适合实时通知、AI 流式输出等场景。连接由客户端发起，服务端保持连接不断推送，客户端只能接收不能发送。

### 基本用法

```js
const es = new EventSource('/api/stream')

es.onopen = function () {
  console.log('连接已建立')
}

es.onmessage = function (e) {
  console.log('收到消息：', e.data)
}

es.onerror = function (e) {
  console.error('连接出错', e)
}
```

### 自定义事件

服务端可以发送命名事件，客户端用 `addEventListener` 监听：

```js
// 服务端推送格式
// event: userJoin
// data: {"name":"Alice"}

es.addEventListener('userJoin', function (e) {
  const user = JSON.parse(e.data)
  console.log(`${user.name} 加入了`)
})
```

### 关闭连接

```js
es.close()
```

### 与 WebSocket 的区别

| | SSE | WebSocket |
| --- | --- | --- |
| 方向 | 单向（服务端 → 客户端） | 双向 |
| 协议 | HTTP | ws / wss |
| 重连 | 自动重连 | 需手动实现 |
| 适用场景 | 通知推送、流式输出 | 实时聊天、游戏 |

---

## sendBeacon

[`navigator.sendBeacon`](https://developer.mozilla.org/zh-CN/docs/Web/API/Navigator/sendBeacon) 用于在页面卸载时可靠地向服务器发送少量数据（如埋点、日志），不会阻塞页面关闭。

### 使用场景

普通的 `fetch` 或 `xhr` 在页面 `unload` 时可能被浏览器中断，`sendBeacon` 能保证数据发出。

### 基本用法

```js
// 发送字符串
navigator.sendBeacon('/api/log', '用户离开了页面')

// 发送 JSON
const data = JSON.stringify({ event: 'page_leave', time: Date.now() })
navigator.sendBeacon('/api/log', data)

// 发送 FormData
const form = new FormData()
form.append('event', 'click')
navigator.sendBeacon('/api/log', form)
```

### 在页面卸载时使用

```js
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    navigator.sendBeacon('/api/log', JSON.stringify({ type: 'leave' }))
  }
})
```

> 推荐监听 `visibilitychange` 而非 `unload` / `beforeunload`，因为移动端的后台切换不一定触发 unload。

### 限制

- 只支持 POST 请求
- 无法自定义请求头（`Content-Type` 由数据类型决定）
- 数据量有上限（通常 64KB）
- 无法获取响应内容，返回值只是 `true`（入队成功）或 `false`

---

## WebSocket

[`WebSocket`](https://developer.mozilla.org/zh-CN/docs/Web/API/WebSocket) 提供全双工通信通道，客户端与服务端可以随时互发消息，适合实时聊天、协同编辑、在线游戏等场景。

### 建立连接

```js
const ws = new WebSocket('wss://example.com/socket')

ws.onopen = function () {
  console.log('连接已建立')
}

ws.onmessage = function (e) {
  console.log('收到消息：', e.data)
}

ws.onerror = function (e) {
  console.error('连接出错', e)
}

ws.onclose = function (e) {
  console.log(`连接关闭，code: ${e.code}，reason: ${e.reason}`)
}
```

### 发送数据

```js
// 发送字符串
ws.send('hello')

// 发送 JSON
ws.send(JSON.stringify({ type: 'chat', content: 'hello' }))

// 发送二进制
ws.send(arrayBuffer)
ws.send(blob)
```

### 关闭连接

```js
// 正常关闭，code 默认 1000
ws.close()

// 带原因关闭
ws.close(1000, '用户主动退出')
```

### 连接状态

通过 `ws.readyState` 判断当前状态：

| 值 | 常量 | 说明 |
| --- | --- | --- |
| 0 | `CONNECTING` | 正在连接 |
| 1 | `OPEN` | 连接已建立，可以通信 |
| 2 | `CLOSING` | 正在关闭 |
| 3 | `CLOSED` | 已关闭 |

```js
if (ws.readyState === WebSocket.OPEN) {
  ws.send('message')
}
```

### 接收二进制数据

默认收到的 `e.data` 是字符串，处理二进制（图片、音视频）时需设置 `binaryType`：

```js
ws.binaryType = 'arraybuffer' // 默认 'blob'，可选 'arraybuffer'

ws.onmessage = function (e) {
  if (e.data instanceof ArrayBuffer) {
    const view = new Uint8Array(e.data)
    console.log('收到二进制数据', view)
  } else {
    console.log('收到文本', e.data)
  }
}
```

### 心跳与断线重连

WebSocket 连接可能因网络波动断开，通常需要实现心跳检测和自动重连：

```js
function createWS(url) {
  let ws
  let heartbeatTimer

  function connect() {
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('已连接')
      heartbeat()
    }

    ws.onmessage = (e) => {
      // 收到 pong 说明连接正常
      if (e.data === 'pong') return
      console.log(e.data)
    }

    ws.onclose = () => {
      clearInterval(heartbeatTimer)
      console.log('连接断开，3秒后重连')
      setTimeout(connect, 3000)
    }
  }

  function heartbeat() {
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping')
      }
    }, 30000)
  }

  connect()
  return () => ws.close() // 返回主动关闭函数
}
```

---

## 如何选择

| | XHR | fetch | SSE | sendBeacon | WebSocket |
| --- | --- | --- | --- | --- | --- |
| 通信方向 | 双向（请求/响应） | 双向（请求/响应） | 单向（服务端推） | 单向（客户端发） | 全双工 |
| 协议 | HTTP | HTTP | HTTP | HTTP | ws / wss |
| Promise | ✗ | ✓ | ✗ | ✗ | ✗ |
| 流式响应 | ✗ | ✓ | ✓ | ✗ | ✓ |
| 取消请求 | `abort()` | `AbortController` | `close()` | ✗ | `close()` |
| 自动重连 | ✗ | ✗ | ✓ | ✗ | 需手动实现 |
| 适用场景 | 兼容旧浏览器、需要上传进度 | 常规接口请求 | AI 流式输出、消息推送 | 埋点、页面卸载日志 | 实时聊天、协同、游戏 |
