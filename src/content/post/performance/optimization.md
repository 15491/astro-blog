---
title: "前端性能优化全景"
description: "系统梳理前端性能优化的核心手段：Web Vitals 指标体系、资源加载、Bundle 优化、Vue3 运行时性能、网络与缓存策略，以及如何用工具量化问题"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["性能优化", "Web Vitals", "Vue3", "webpack", "缓存"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 前端性能优化全景

性能优化最常见的误区是**凭感觉优化**——优化了很多，但用户感知不到差别。正确的姿势是先量化指标、定位瓶颈，再针对性下手。

本文按照"先看指标 → 加载层 → Bundle 层 → 运行时层 → 网络层"的顺序展开。

---

## 性能指标体系

### Core Web Vitals

Google 定义的三个核心指标，直接影响 SEO 排名和用户体验：

| 指标 | 全称 | 含义 | 优秀 | 需改进 |
|------|------|------|------|--------|
| LCP | Largest Contentful Paint | 最大内容元素渲染完成的时间 | < 2.5s | > 4s |
| FID | First Input Delay | 首次输入延迟（交互响应速度） | < 100ms | > 300ms |
| CLS | Cumulative Layout Shift | 累计布局偏移（页面稳定性） | < 0.1 | > 0.25 |

:::note[FID → INP]
Google 已将 FID 替换为 INP（Interaction to Next Paint），衡量整个页面生命周期内所有交互的响应速度，比 FID 更全面。2024 年 3 月起正式生效。
:::

### 其他关键指标

```
TTFB（Time to First Byte）    服务器首字节响应时间，衡量服务端+网络速度
FCP（First Contentful Paint） 首次出现任何内容的时间
TTI（Time to Interactive）    页面完全可交互的时间
TBT（Total Blocking Time）    主线程被长任务阻塞的总时长
```

### 如何采集

用 `web-vitals` 库上报指标，结合埋点系统持续监控：

```ts title="utils/vitals.ts"
import { onCLS, onFID, onLCP, onINP, onFCP, onTTFB } from 'web-vitals'

const report = (metric: { name: string; value: number; rating: string }) => {
  // 上报到监控平台
  navigator.sendBeacon('/api/vitals', JSON.stringify(metric))
}

onCLS(report)
onFID(report)
onLCP(report)
onINP(report)
onFCP(report)
onTTFB(report)
```

---

## 资源加载优化

### 图片优化

图片通常是页面体积最大的资源，也是 LCP 最常见的瓶颈。

**格式选择**：

| 格式 | 适用场景 | 说明 |
|------|----------|------|
| WebP | 通用替代 JPEG/PNG | 比 JPEG 小 25~35%，支持透明 |
| AVIF | 极致压缩 | 比 WebP 再小 20%，兼容性稍差 |
| SVG | 图标/矢量图 | 无损缩放，体积极小 |
| JPEG | 照片类图片 | 兼容性最好，有损压缩 |

**懒加载**：

```html
<!-- 原生懒加载，浏览器原生支持，零成本 -->
<img src="photo.webp" loading="lazy" alt="..." />
```

**响应式图片**：

```html
<!-- 根据设备分辨率和屏幕宽度加载合适尺寸 -->
<img
  srcset="photo-400.webp 400w, photo-800.webp 800w, photo-1200.webp 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1200px) 800px, 1200px"
  src="photo-800.webp"
  alt="..."
/>
```

:::tip[LCP 图片不要懒加载]
LCP 元素通常是首屏的大图或 Banner。对它用 `loading="lazy"` 会让浏览器推迟加载，反而拖慢 LCP。首屏关键图片要主动预加载。
:::

**预加载关键资源**：

```html
<!-- 让浏览器提前发现并加载 LCP 图片 -->
<link rel="preload" as="image" href="hero.webp" />

<!-- 字体预加载，防止 FOIT（不可见文本闪烁） -->
<link rel="preload" as="font" href="font.woff2" type="font/woff2" crossorigin />
```

### 字体优化

```css
@font-face {
  font-family: 'MyFont';
  src: url('font.woff2') format('woff2');
  /* 先用系统字体显示文本，字体加载完再替换，避免布局偏移 */
  font-display: swap;
}
```

---

## Bundle 优化

### 代码分割

将一个大 Bundle 拆成多个小 chunk，按需加载，降低首屏 JS 体积：

**路由级分割（最重要）**：

```ts title="router/index.ts"
const routes = [
  {
    path: '/dashboard',
    // 每个路由单独打包，访问时才下载
    component: () => import('@/views/Dashboard.vue'),
  },
  {
    path: '/report',
    component: () => import('@/views/Report.vue'),
  },
]
```

**组件级按需加载**：

```ts
// 大型弹窗/抽屉，只有打开时才需要
const HeavyDialog = defineAsyncComponent(
  () => import('@/components/HeavyDialog.vue')
)
```

### Tree Shaking

Tree Shaking 依赖 ES Module 的静态分析，打包时自动删除未使用的代码。前提是**不要用 CommonJS**：

```ts
// ✅ 支持 tree shaking（ES Module 具名导入）
import { debounce } from 'lodash-es'

// ❌ 会把整个 lodash 打进去
import _ from 'lodash'
import { debounce } from 'lodash'  // lodash 是 CJS，无法 tree shake
```

Element Plus 等主流 UI 库已支持按需引入，配合 `unplugin-vue-components` 可以自动按需导入，无需手动 import：

```ts title="vite.config.ts"
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
})
```

### 分包策略

合理的分包能最大化浏览器缓存利用率：

```ts title="vite.config.ts"
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // 第三方框架单独一包（变化频率低，长期缓存）
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          // UI 库单独一包
          'vendor-ui': ['element-plus'],
          // 工具库单独一包
          'vendor-utils': ['axios', 'dayjs', 'lodash-es'],
        },
      },
    },
  },
})
```

:::note[为什么要分包]
业务代码每次发布都会变化，而 Vue、Element Plus 等依赖库几乎不变。分开打包后，用户再次访问时业务包重新下载，但依赖包命中缓存，整体下载量大幅减少。
:::

### 分析 Bundle 体积

```bash
# Vite 项目
npx vite-bundle-visualizer

# Webpack 项目
npx webpack-bundle-analyzer stats.json
```

运行后会生成一张可视化的 Treemap，能直观看出哪个依赖占用了大量体积。

---

## Vue3 运行时优化

### 避免不必要的响应式

`ref` 和 `reactive` 会对数据进行 Proxy 代理，大量数据时有开销：

```ts
// ❌ 静态配置不需要响应式
const columns = reactive([
  { prop: 'name', label: '姓名' },
  { prop: 'age', label: '年龄' },
])

// ✅ 用普通变量或 shallowRef
const columns = [
  { prop: 'name', label: '姓名' },
  { prop: 'age', label: '年龄' },
]

// ✅ 大型数据只需要外层响应式时用 shallowRef
const tableData = shallowRef<Row[]>([])
```

**`shallowRef` vs `ref`**：

| | `ref` | `shallowRef` |
|--|-------|-------------|
| 深度代理 | 是，递归代理所有嵌套属性 | 否，只代理 `.value` 本身 |
| 适合场景 | 需要深层响应的小对象 | 大型数组/对象，只关心整体替换 |

### computed 避免重复计算

```ts
// ❌ 模板中直接调用函数，每次渲染都重新计算
const expensiveList = () => rawList.value.filter(...).sort(...)

// ✅ computed 有缓存，依赖不变就不重新计算
const expensiveList = computed(() => rawList.value.filter(...).sort(...))
```

### v-memo 跳过子树渲染

```html
<!-- list 中每一行，只有 item.id 和 selected 变化时才重新渲染 -->
<div v-for="item in list" :key="item.id" v-memo="[item.id, item.selected]">
  <p>{{ item.name }}</p>
  <p>{{ item.description }}</p>
  <!-- 大量内容... -->
</div>
```

:::tip[v-memo 的使用场景]
`v-memo` 适合列表渲染中内容复杂、但只有少数字段会变化的场景。对简单列表收益有限，加了反而增加比较开销。
:::

### 虚拟列表

渲染 10000 条数据时，DOM 节点数量是性能杀手。虚拟列表只渲染可视区域内的节点：

```
总数据: 10000 条
可视区域: 20 条
DOM 节点: 始终只有 ~30 个（20 可见 + 上下各 5 缓冲）
```

推荐使用 `vue-virtual-scroller` 或 `@tanstack/virtual`，无需手写：

```html
<RecycleScroller
  :items="largeList"
  :item-size="50"
  key-field="id"
  v-slot="{ item }"
>
  <div class="list-item">{{ item.name }}</div>
</RecycleScroller>
```

### 避免 v-if 和 v-for 同级

```html
<!-- ❌ 每次渲染都先过滤再判断，且有优先级歧义 -->
<li v-for="item in list" v-if="item.active" :key="item.id">

<!-- ✅ 先用 computed 过滤，模板保持纯展示 -->
<li v-for="item in activeList" :key="item.id">
```

---

## 网络与缓存优化

### HTTP 缓存策略

合理配置缓存头，让浏览器复用资源：

```
# 带 hash 的文件（内容变了 hash 就变）→ 永久缓存
Cache-Control: max-age=31536000, immutable

# index.html → 不缓存，每次都重新验证
Cache-Control: no-cache

# API 响应 → 根据业务决定
Cache-Control: max-age=300  # 5 分钟内不重新请求
```

:::warning[index.html 一定不要强缓存]
如果 `index.html` 被缓存，新版本发布后用户看到的还是旧页面，即使 JS/CSS 文件已经更新了（因为 HTML 里的 `<script src>` 引用的还是旧的 hash 文件名）。
:::

### 资源优先级提示

```html
<!-- 关键请求提前建立连接 -->
<link rel="preconnect" href="https://api.example.com" />
<link rel="dns-prefetch" href="https://cdn.example.com" />

<!-- 下一个页面可能用到的资源提前加载 -->
<link rel="prefetch" href="/next-page.js" />
```

### 减少请求数

**合并小图标**：用 SVG Sprite 或 Icon Font 代替大量小图片请求：

```html
<!-- SVG Sprite，一次请求，多处复用 -->
<svg><use href="#icon-search" /></svg>
```

**接口合并**：BFF（Backend for Frontend）层将多个接口聚合成一个，减少前端并发请求数。

### Gzip / Brotli 压缩

服务端开启压缩，JS/CSS 体积能减少 60~80%：

```nginx
# Nginx 配置
gzip on;
gzip_types text/javascript application/javascript text/css;
gzip_min_length 1024;

# Brotli（比 gzip 压缩率更高，需要模块支持）
brotli on;
brotli_types text/javascript application/javascript text/css;
```

Vite 可以在构建时预生成压缩文件，Nginx 直接返回静态 `.gz` 文件，不占用服务器 CPU：

```ts title="vite.config.ts"
import viteCompression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    viteCompression({ algorithm: 'brotliCompress' }),
  ],
})
```

---

## 工具链

### Lighthouse

Chrome DevTools 内置，一键生成性能报告：

```
DevTools → Lighthouse → 选择 Performance → Generate report
```

报告会给出 LCP / FID / CLS / TBT / FCP 的具体数值和改进建议，直接按建议逐条处理。

### Performance 面板

```
DevTools → Performance → 录制 → 操作页面 → 停止
```

重点关注：
- **Long Tasks（红色标记）**：超过 50ms 的主线程任务，会阻塞交互
- **Flame Chart**：找出耗时的 JS 函数
- **Layout / Paint / Composite**：定位渲染瓶颈

### Bundle 分析

```bash
# 查看哪些依赖占了最大空间
npx vite-bundle-visualizer       # Vite
npx webpack-bundle-analyzer      # Webpack
```

---

## 优化优先级参考

实际项目中不可能面面俱到，按收益/成本排序：

| 优先级 | 措施 | 效果 |
|--------|------|------|
| 高 | 路由懒加载 | 首屏 JS 体积直接减半 |
| 高 | 图片格式转 WebP + 懒加载 | 流量减少 30%+ |
| 高 | 开启 Gzip/Brotli | 文本资源减少 60%+ |
| 高 | 正确配置 HTTP 缓存 | 回访用户 0 下载 |
| 中 | 第三方依赖分包 | 最大化缓存命中 |
| 中 | Element Plus 按需引入 | UI 库体积减少 70%+ |
| 中 | 虚拟列表（大数据场景） | 避免 DOM 过多卡顿 |
| 低 | v-memo / shallowRef | 精细调优，收益因场景而异 |
| 低 | Brotli 预压缩 | 比 Gzip 再提升 10~20% |

:::caution[测量再优化]
优化前先用 Lighthouse 或 DevTools 量化当前数据，优化后再次测量确认改善。没有测量的优化，等于没做。
:::
