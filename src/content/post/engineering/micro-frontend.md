---
title: "微前端架构实践：Module Federation、qiankun、无界与 Web Components"
description: "从微前端的核心问题出发，对比 iframe、npm 包、Module Federation、qiankun、无界、Web Components 六种方案的适用边界，深入拆解各方案的隔离机制、通信模型与接入成本"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["微前端", "Module Federation", "qiankun", "工程实践", "架构"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 微前端架构实践：Module Federation、qiankun、无界与 Web Components

微前端不是银弹，引入它的代价是显而易见的——构建复杂度上升、调试链路变长、依赖版本需要协调。在此之前，先想清楚**为什么需要微前端**：

- **团队边界**：多个团队独立开发、独立部署，互不等待
- **技术栈差异**：老系统 Vue 2，新功能用 Vue 3 或 React，需要共存
- **存量系统集成**：把多个独立系统聚合到一个统一 Portal

如果只是单团队 + 单技术栈的大型项目，monorepo + 路由分包通常就够了，引入微前端只会增加复杂度。

---

## 微前端方案对比

### iframe

最简单的隔离方案，天然的 JS / CSS / DOM 隔离：

```html
<iframe src="https://app-b.example.com/feature" frameborder="0"></iframe>
```

**优点**：零接入成本，隔离最彻底

**缺点**：
- URL 不同步（刷新回到首页）
- 弹窗/下拉框无法突破 iframe 边界
- 通信只能用 `postMessage`，笨重
- SEO 不友好，性能差（每个 iframe 是独立浏览器上下文）

适合：内嵌完全独立的三方系统，且不需要深度交互的场景。

### npm 包共享

把公共组件或业务模块发布为 npm 包，各应用独立引入：

```
app-shell (主应用)
  └── @company/feature-order (业务包)
  └── @company/feature-user (业务包)
```

**优点**：依赖版本明确，构建产物可预期

**缺点**：每次更新需要重新发版 + 各应用升级依赖 + 重新构建部署，不能独立部署

适合：共享组件库、工具函数，不适合需要独立迭代的业务模块。

### Module Federation（Webpack 5）

运行时共享模块，子应用可以**动态暴露**自身代码，其他应用**运行时加载**而不是编译时打包：

**适合**：同技术栈或相近技术栈、需要细粒度模块共享、Webpack 项目。

### qiankun（基于 single-spa）

完整的微前端框架，主应用注册子应用，子应用独立部署，框架负责加载、卸载、隔离：

**适合**：多技术栈共存、需要完整生命周期管理、有存量系统需要接入。

### 无界（wujie）

腾讯开源，结合了 **iframe JS 沙箱** 和 **Web Components 渲染容器**，试图同时解决 iframe 的隔离优势和渲染局限：

- JS 运行在 iframe 的原生隔离环境中（天然隔离，无需模拟 Proxy）
- DOM 渲染在主应用的 Web Component（`<wujie-app>`）内，突破了 iframe 的渲染边界

**适合**：需要强隔离、对 CSS 污染容忍度低、子应用无需大量改造的场景。

### Web Components 原生方案

把每个子应用封装成 Custom Element，通过 Shadow DOM 天然隔离 CSS，不依赖任何微前端框架：

**适合**：团队有能力自建框架层、技术栈统一且以 Web Components 友好的框架为主。

---

## Module Federation 深度实践

### 核心概念

- **Host（主机）**：消费其他应用暴露的模块
- **Remote（远端）**：暴露自己的模块供他人使用
- **Shared（共享）**：声明哪些依赖在运行时共享，避免重复加载（如 Vue、React）

同一个应用可以同时是 Host 和 Remote。

### 配置示例

**子应用（Remote）暴露组件**：

```ts title="apps/order/vite.config.ts"
import { defineConfig } from 'vite'
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    federation({
      name: 'order-app',
      filename: 'remoteEntry.js',  // 入口文件名
      exposes: {
        // key 是对外暴露的模块名，value 是本地路径
        './OrderList': './src/components/OrderList.vue',
        './OrderDetail': './src/pages/OrderDetail.vue',
        './useOrder': './src/composables/useOrder.ts',
      },
      shared: ['vue', 'vue-router', 'pinia'],
    }),
  ],
  build: {
    target: 'esnext',
  },
})
```

**主应用（Host）消费远端模块**：

```ts title="apps/shell/vite.config.ts"
import federation from '@originjs/vite-plugin-federation'

export default defineConfig({
  plugins: [
    federation({
      name: 'shell-app',
      remotes: {
        // key 是引用时的别名，value 是远端入口的 URL
        'order-app': 'https://order.example.com/assets/remoteEntry.js',
      },
      shared: ['vue', 'vue-router', 'pinia'],
    }),
  ],
})
```

```ts title="apps/shell/src/router/index.ts"
const routes = [
  {
    path: '/orders',
    // 像普通模块一样导入，但实际从远端 URL 加载
    component: () => import('order-app/OrderList'),
  },
  {
    path: '/orders/:id',
    component: () => import('order-app/OrderDetail'),
  },
]
```

### 运行时原理

Module Federation 生成的 `remoteEntry.js` 是一个模块注册表：

```
访问 /orders 路由
  → 动态 import('order-app/OrderList')
  → 检查本地是否已加载 order-app 的 remoteEntry.js
  → 未加载则 fetch('https://order.example.com/assets/remoteEntry.js')
  → 执行 remoteEntry，注册 order-app 的模块映射
  → 从映射中找到 OrderList 对应的 chunk URL
  → 加载该 chunk，返回组件
```

### shared 依赖的版本协商

`shared` 配置是 Module Federation 最容易踩坑的地方。当主应用和子应用声明共享同一个依赖时，运行时会进行版本协商：

```ts
shared: {
  vue: {
    singleton: true,   // 全局只用一个实例（Vue / React 必须设为 true）
    requiredVersion: '^3.0.0',  // 接受的版本范围
  },
  'element-plus': {
    singleton: false,  // 允许各自用不同版本
  },
}
```

:::warning[singleton 的重要性]
Vue、React、Pinia、Vue Router 等有全局状态的库**必须设置 `singleton: true`**。否则主应用和子应用各自加载一份实例，`inject` / `useRouter` 等跨应用调用会找不到 provide 的值，产生难以排查的 bug。
:::

### 通信方案

Module Federation 没有内置通信机制，推荐用共享的 Store 或事件总线：

```ts title="packages/shared-store/src/index.ts"
// 主应用和子应用共享这个包（通过 shared 配置共用同一实例）
import { defineStore } from 'pinia'

export const useGlobalStore = defineStore('global', {
  state: () => ({
    user: null as User | null,
    locale: 'zh-CN',
  }),
})
```

```ts title="packages/shared-store/src/eventBus.ts"
// 简单事件总线，用于不需要状态的一次性通知
type EventMap = {
  'order:created': { orderId: string }
  'user:logout': void
}

class EventBus {
  private handlers = new Map<string, Set<Function>>()

  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)  // 返回取消订阅函数
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]) {
    this.handlers.get(event)?.forEach(h => h(data))
  }
}

export const eventBus = new EventBus()
```

---

## qiankun 深度实践

### 主应用配置

```ts title="src/micro/index.ts"
import { registerMicroApps, start } from 'qiankun'

registerMicroApps([
  {
    name: 'order-app',
    entry: '//localhost:8001',   // 子应用的访问地址
    container: '#micro-container',  // 挂载到主应用的哪个 DOM 节点
    activeRule: '/order',       // URL 匹配规则，命中时激活子应用
    props: {                    // 传给子应用的初始化数据
      token: () => store.getters.token,
      onNavigate: (path: string) => router.push(path),
    },
  },
  {
    name: 'user-app',
    entry: '//localhost:8002',
    container: '#micro-container',
    activeRule: '/user',
  },
])

start({
  prefetch: 'all',      // 预加载所有子应用资源
  sandbox: {
    strictStyleIsolation: true,  // 开启严格样式隔离（Shadow DOM）
  },
})
```

### 子应用改造

子应用需要导出三个生命周期函数，并处理独立运行和作为子应用运行两种模式：

```ts title="src/main.ts"
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

let app: ReturnType<typeof createApp> | null = null

// 判断是否在 qiankun 环境中运行
const inQiankun = window.__POWERED_BY_QIANKUN__

if (inQiankun) {
  // 注入 webpack publicPath，确保子应用的静态资源路径正确
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__webpack_public_path__ = window.__INJECTED_PUBLIC_PATH_BY_QIANKUN__
}

// 独立运行时直接挂载
if (!inQiankun) {
  mount({})
}

// qiankun 生命周期
export async function bootstrap() {
  // 子应用初始化（只执行一次）
}

export async function mount(props: Record<string, unknown>) {
  app = createApp(App)
  app.use(router)
  // 接收主应用传来的 props
  app.provide('microProps', props)
  app.mount(props.container ? `${props.container} #app` : '#app')
}

export async function unmount() {
  app?.unmount()
  app = null
}
```

**webpack 配置（子应用必须设置）**：

```js title="vue.config.js"
const { name } = require('./package.json')

module.exports = {
  devServer: {
    headers: {
      'Access-Control-Allow-Origin': '*',  // 允许主应用跨域加载
    },
  },
  configureWebpack: {
    output: {
      library: name,
      libraryTarget: 'umd',  // qiankun 要求 UMD 格式
      jsonpFunction: `webpackJsonp_${name}`,
    },
  },
}
```

### 沙箱机制

qiankun 提供三种 JS 沙箱，默认使用 `LegacySandbox` 或 `ProxySandbox`：

**SnapshotSandbox（不支持 Proxy 的降级方案）**：
- 激活时：记录当前 `window` 快照
- 卸载时：还原快照，记录子应用对 `window` 的修改
- 缺点：每次激活/卸载需要遍历整个 `window` 对象，且不支持多实例

**ProxySandbox（主流方案）**：
- 用 `Proxy` 代理 `window`，子应用的全局变量读写都走代理
- 真实 `window` 不被污染
- 支持多个子应用同时运行（各自有独立的代理对象）

```ts
// ProxySandbox 的核心原理（简化）
class ProxySandbox {
  private fakeWindow = Object.create(null)
  proxy: typeof window

  constructor() {
    this.proxy = new Proxy(this.fakeWindow, {
      set(target, key, value) {
        target[key] = value  // 写入沙箱，不污染真实 window
        return true
      },
      get(target, key) {
        // 优先从沙箱读，沙箱没有才从真实 window 读
        return key in target ? target[key] : (window as any)[key]
      },
    })
  }
}
```

### 样式隔离

**strictStyleIsolation（Shadow DOM）**：

将子应用挂载在 Shadow DOM 内，CSS 天然隔离，但 `document.body` 上的弹窗（Element Plus 的 `el-dialog` 默认 append 到 body）样式会失效：

```ts
// Element Plus 弹窗挂载到子应用容器内，而非 body
ElDialog.setup = (props, ctx) => {
  return { ...ElDialog.setup(props, ctx), appendTo: '#micro-container' }
}
// 或通过 app.config.globalProperties 统一设置
```

**experimentalStyleIsolation（CSS Scope 前缀）**：

qiankun 自动给子应用所有 CSS 规则加上 `div[data-qiankun="app-name"]` 前缀，不需要 Shadow DOM，兼容性更好，但无法隔离动态插入到 body 的样式。

---

## 无界（wujie）深度实践

### 架构原理

无界的核心思路是把 iframe 和 Web Components 的优点组合起来：

```
子应用 JS  →  运行在隐藏的 iframe 内（原生 JS 隔离）
子应用 DOM →  渲染在主应用的 <wujie-app> Shadow DOM 内

iframe 中的 document 被劫持代理：
  读 document.body  →  实际返回 Web Component 的 shadowRoot
  写 DOM 操作       →  操作到 shadowRoot 上，而非 iframe 内部
```

这个设计解决了传统 iframe 的两个核心痛点：
- **URL 不同步**：子应用路由变化通过 proxy 同步到主应用 URL
- **弹窗穿透**：`document.body` 被代理为 shadowRoot，弹窗挂载在主应用可见区域内

### 接入方式

```bash
pnpm add wujie-vue3
```

**主应用注册并使用**：

```ts title="src/main.ts"
import WujieVue from 'wujie-vue3'
import { setupApp } from 'wujie'

app.use(WujieVue)

// 预加载子应用（可选，提升首次激活速度）
setupApp({
  name: 'order-app',
  url: '//localhost:8001',
  exec: true,  // 预执行 JS，激活时直接切换，无需重新加载
})
```

```html title="src/views/Layout.vue"
<!-- 像使用普通组件一样嵌入子应用 -->
<WujieVue
  name="order-app"
  url="//localhost:8001"
  :props="{ token, onNavigate }"
  @lifecycle="onLifecycle"
/>
```

**子应用几乎无需改造**，只需保证跨域访问头：

```js title="vite.config.js（子应用）"
export default {
  server: {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
}
```

:::tip[无界的最大优势：子应用零改造]
qiankun 要求子应用导出 bootstrap/mount/unmount 生命周期并修改 webpack 输出格式。无界不需要这些，存量应用直接接入，接入成本极低。
:::

### 三种运行模式

```ts
// 1. 单例模式（默认）：子应用只有一个实例，切换时保活
setupApp({ name: 'order-app', url: '//localhost:8001', alive: true })

// 2. 预执行模式：提前执行 JS，激活时直接渲染
setupApp({ name: 'order-app', url: '//localhost:8001', exec: true })

// 3. 重建模式：每次激活都重新创建实例（适合需要完全重置状态的场景）
// 不设置 alive 和 exec，每次 WujieVue 挂载都重建
```

**保活模式（alive: true）** 是无界的核心特性：子应用被「激活」和「切走」时，实例不销毁，类似 Vue 的 `<keep-alive>`。用户从订单列表切到用户页再切回来，滚动位置、表单输入都保留。

### 通信

```ts
// 主应用向子应用发送事件
import { bus } from 'wujie'
bus.$emit('global:user-change', { userId: 1, name: 'Alice' })

// 子应用监听（在子应用的任意位置）
window.$wujie?.bus.$on('global:user-change', (user) => {
  console.log('收到用户变更', user)
})

// 子应用向主应用发送（通过 props 传入回调）
const { onOrderCreate } = window.$wujie?.props ?? {}
onOrderCreate?.({ orderId: 'order-123' })
```

### 已知局限

- Shadow DOM 内的全局弹窗（Teleport to body）默认脱离了 shadowRoot 范围，需要将 Teleport 目标指向 shadowRoot 内的节点
- 部分依赖 `document.currentScript` 或 `document.head` 的第三方库（如某些地图 SDK）需要额外适配
- iOS Safari 对 Shadow DOM 的支持历史上有 bug，需要测试

---

## 基于 Web Components 的方案

Web Components 是浏览器原生标准，由三项技术组成：

| 技术 | 作用 |
|------|------|
| Custom Elements | 定义自定义 HTML 标签，附加生命周期 |
| Shadow DOM | CSS 和 DOM 隔离的封装边界 |
| HTML Templates | `<template>` 标签定义可复用的 DOM 片段 |

### 用 Custom Elements 封装子应用容器

以 Vue 子应用为例，把整个 Vue 应用封装成一个 Custom Element：

```ts title="order-app/src/element.ts"
import { createApp, defineComponent, h } from 'vue'
import App from './App.vue'
import router from './router'

class OrderAppElement extends HTMLElement {
  private app: ReturnType<typeof createApp> | null = null
  private mountRoot: ShadowRoot

  constructor() {
    super()
    // 创建 Shadow DOM，open 模式允许外部通过 JS 访问 shadowRoot
    this.mountRoot = this.attachShadow({ mode: 'open' })
  }

  // 元素挂载到 DOM 时触发
  connectedCallback() {
    const container = document.createElement('div')
    this.mountRoot.appendChild(container)

    this.app = createApp(App)
    this.app.use(router)
    this.app.mount(container)
  }

  // 元素从 DOM 移除时触发
  disconnectedCallback() {
    this.app?.unmount()
    this.app = null
  }

  // 监听哪些 attribute 变化
  static get observedAttributes() {
    return ['token', 'locale']
  }

  // attribute 变化时触发
  attributeChangedCallback(name: string, _old: string, newVal: string) {
    if (name === 'token') {
      // 将 token 传入 Vue 应用
      this.app?.provide('token', newVal)
    }
  }
}

// 注册自定义元素
customElements.define('order-app', OrderAppElement)
```

**主应用使用**：

```html
<!-- 像使用原生 HTML 标签一样嵌入子应用 -->
<order-app token="eyJhbGci..." locale="zh-CN"></order-app>

<!-- 动态创建 -->
<script>
const el = document.createElement('order-app')
el.setAttribute('token', userToken)
document.getElementById('container').appendChild(el)
</script>
```

### Shadow DOM 的 CSS 隔离

Shadow DOM 内部样式和外部完全隔离：

```ts
connectedCallback() {
  const container = document.createElement('div')

  // 在 Shadow DOM 内注入样式，不会泄漏到外部
  const style = document.createElement('style')
  style.textContent = `
    :host {
      display: block;        /* Custom Element 默认是 inline */
      width: 100%;
    }
    .order-list {
      padding: 16px;         /* 这个类名不会影响外部同名类 */
    }
  `
  this.mountRoot.appendChild(style)
  this.mountRoot.appendChild(container)
}
```

外部 CSS 也无法穿透进 Shadow DOM（除了 CSS 自定义属性 / CSS Variables）：

```css
/* 主应用想修改子应用样式，只能通过 CSS 变量 */
order-app {
  --primary-color: #1677ff;
  --font-size-base: 14px;
}

/* 子应用内部读取 */
.btn {
  color: var(--primary-color, #000);
}
```

### 跨框架使用

Web Components 与框架无关，可以在 Vue、React、原生 HTML 中统一使用：

```tsx
// React 中使用 Vue 写的子应用
function App() {
  return (
    <div>
      <order-app token={userToken} />
    </div>
  )
}
```

```html
<!-- 原生 HTML 中使用 -->
<script type="module" src="https://order.example.com/element.js"></script>
<order-app token="xxx"></order-app>
```

:::note[框架对 Web Components 的支持]
Vue 3 对 Web Components 支持较好，可直接使用自定义元素。React 18 之前对 Web Components 的事件系统有已知兼容问题（React 19 已修复）。Angular 有完善的 Web Components 支持，甚至可以直接将 Angular 组件导出为 Custom Element。
:::

### 局限

- **通信只能靠 attribute / 事件**：复杂数据传递（对象、函数）需要用 `element.dataset` 或自定义事件，不如框架 props 直观
- **CSS 变量穿透有限**：只能通过 CSS 变量做有限的主题定制，无法像普通 CSS 一样覆盖内部样式
- **SSR 支持差**：`customElements.define` 是浏览器 API，服务端渲染需要额外处理
- **调试工具链较弱**：Vue DevTools、React DevTools 无法透视 Shadow DOM 内的组件树

---

## 路由协同

主应用和子应用都有各自的路由，需要协调避免冲突：

```ts title="子应用 router/index.ts"
const router = createRouter({
  history: createWebHistory(
    // 独立运行时用 '/'，在 qiankun 中用主应用分配的 base
    window.__POWERED_BY_QIANKUN__ ? '/order' : '/'
  ),
  routes,
})
```

主应用路由变化触发子应用激活/卸载，子应用内部路由变化同步到主应用地址栏：

```ts title="子应用内导航"
// 通过主应用传入的 onNavigate 通知主应用同步 URL
const { onNavigate } = inject('microProps') as MicroProps
onNavigate('/order/detail/123')
```

---

## 方案选择参考

| 维度 | Module Federation | qiankun | 无界 | Web Components |
|------|-------------------|---------|------|----------------|
| 隔离粒度 | 模块级 | 应用级 | 应用级 | 组件级 |
| JS 隔离 | 无 | Proxy 沙箱 | iframe 原生隔离 | 无（共享主应用 window） |
| CSS 隔离 | 无内置 | Scope 前缀 / Shadow DOM | Shadow DOM | Shadow DOM（原生） |
| 子应用改造量 | 小（调整构建配置） | 中（导出生命周期 + UMD） | 极小（几乎零改造） | 大（需封装为 Custom Element） |
| 多技术栈支持 | 弱（同技术栈最佳） | 强 | 强 | 强（框架无关） |
| 保活（keep-alive） | 需自行实现 | 不支持 | 原生支持 | 需自行实现 |
| 弹窗穿透问题 | 无 | 有（Shadow DOM 模式下） | 已处理 | 有（Shadow DOM 内弹窗） |
| 依赖框架 | Webpack / Vite 插件 | qiankun | wujie | 浏览器原生 |
| 适合场景 | 组件/逻辑跨应用共享 | 多技术栈聚合 Portal | 强隔离 + 低改造成本 | 跨框架组件发布 |

### 如何选

```
需要细粒度共享组件或逻辑？
  → Module Federation

有存量系统需要接入、多技术栈共存？
  ├── 子应用可以改造 → qiankun
  └── 子应用无法改造 / 需要强隔离 → 无界

构建跨框架的通用 UI 组件库、或发布给外部消费？
  → Web Components
```

:::tip[从简单方案开始]
实际落地时，先用 monorepo + 路由懒加载满足 90% 的场景。只有当**团队独立部署**的需求真实存在时，才引入微前端。qiankun 生态成熟、文档完善，是国内最常见的选择；无界在接入历史遗留系统时优势明显；Module Federation 在 Vite + 同技术栈场景下最轻量。
:::
