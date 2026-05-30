---
title: "浏览器渲染原理：从输入 URL 到页面显示"
description: "拆解浏览器的完整渲染管线：HTML 解析与 DOM 构建、样式计算、布局、分层合成，深入 Event Loop 和任务调度机制，再到 V8 的内存管理与 GC，理解这些底层原理是做好性能优化的前提"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["浏览器", "渲染原理", "Event Loop", "V8", "性能优化"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 浏览器渲染原理：从输入 URL 到页面显示

性能优化有两种方式：一种是「背结论」——用 `will-change`、开启 GPU 加速、避免强制同步布局；另一种是理解浏览器**为什么**这样设计，推导出正确做法。

后者更难，但一通百通。本文从渲染管线到 Event Loop，再到 V8 内存管理，试图建立一个完整的底层心智模型。

---

## 渲染管线总览

浏览器拿到 HTML 后，到像素出现在屏幕上，经历以下阶段：

```
HTML → [解析] → DOM Tree
CSS  → [解析] → CSSOM Tree
              ↓
        [样式计算] → Render Tree（带样式的 DOM）
              ↓
           [布局] → 确定每个节点的几何信息（位置、尺寸）
              ↓
           [分层] → Layer Tree（哪些节点独立成层）
              ↓
           [绘制] → 记录绘制指令（不是真的画）
              ↓
         [栅格化] → 图块 → GPU 纹理
              ↓
           [合成] → GPU 将各层合并，输出到屏幕
```

性能优化的本质是**减少或跳过管线中代价高的阶段**。

---

## DOM 构建与解析阻塞

### HTML 解析

浏览器用**流式**方式解析 HTML，边下载边构建 DOM，不需要等全部下载完。HTML 解析器是状态机，遇到不同 token（开始标签、结束标签、文本、注释）转换状态并构建树节点。

解析过程中会触发**预扫描器**（Preload Scanner）提前发现资源引用（`<link>`、`<img>`、`<script>`），并行发起请求，这是 `<link rel="preload">` 能加速资源的原因之一。

### JS 是解析阻塞的

遇到 `<script>` 标签时，HTML 解析**完全停止**，等待脚本下载并执行完毕，因为 JS 可能通过 `document.write` 修改文档流：

```
[解析 HTML] → [遇到 <script>] → [停止] → [下载 JS] → [执行 JS] → [恢复解析]
```

这就是为什么传统最佳实践把 `<script>` 放在 `</body>` 前。`defer` 和 `async` 改变了这个行为：

| 属性 | 下载 | 执行时机 | 顺序 |
|------|------|----------|------|
| 无属性 | 阻塞解析 | 立即执行 | 顺序 |
| `async` | 并行下载 | 下载完立即执行，可能打断解析 | 不保证 |
| `defer` | 并行下载 | DOMContentLoaded 前，解析完后执行 | 保证顺序 |

:::tip[现代项目的脚本策略]
Vite/Webpack 生成的入口 `<script type="module">` 默认等价于 `defer`，不需要手动处理。`async` 适合独立的第三方分析脚本（如统计 SDK），它们不依赖页面内容，也不被页面依赖。
:::

### CSS 阻塞渲染但不阻塞解析

CSS 不阻塞 DOM 解析，但会阻塞**渲染**（因为需要 CSSOM 才能计算样式）。CSS 还会阻塞其后的 JS 执行（因为 JS 可能读取样式）：

```
[解析 HTML]  ────────────────────────────→
[下载 CSS]   ──────────→ [构建 CSSOM]
[下载 JS]    ────────────────────────────→ [等 CSSOM] → [执行]
[渲染]                                                 → [开始]
```

所以 `<link rel="stylesheet">` 要尽早放在 `<head>`，让 CSS 尽早下载完毕，避免拖延首次渲染。

---

## 样式计算

CSSOM 构建完成后，浏览器将 CSS 规则与 DOM 节点匹配，计算每个节点的最终样式（Computed Style）。

CSS 选择器的匹配是**从右向左**的：`.container .item span` 先找所有 `span`，再逐层向上验证父级是否匹配。这意味着选择器越长，样式计算越慢。

```css
/* 低效：需要向上追溯多层 */
.sidebar .nav-list .nav-item .nav-link span { }

/* 高效：直接定位到元素 */
.nav-link-text { }
```

---

## 布局（Layout / Reflow）

布局阶段确定 Render Tree 中每个节点的**几何信息**：位置（x, y）和尺寸（width, height）。

布局是**整树计算**的——一个节点的尺寸变化，可能影响它的父节点和兄弟节点，触发大范围重算。这就是 `reflow` 代价高的原因。

### 什么会触发 Layout

- 修改影响几何的 CSS 属性：`width`、`height`、`margin`、`padding`、`font-size`、`display` 等
- 读取几何属性：`offsetWidth`、`getBoundingClientRect()`、`scrollTop` 等

**强制同步布局（Forced Synchronous Layout）** 是最常见的性能陷阱：

```ts
// ❌ 在同一帧内交替读写几何属性，每次读取都强制浏览器提前布局
for (const item of items) {
  const width = item.offsetWidth   // 读 → 强制布局
  item.style.width = width + 10 + 'px'  // 写 → 使布局失效
  // 下一次循环再读，又强制布局...
}

// ✅ 先批量读，再批量写
const widths = items.map(item => item.offsetWidth)  // 一次性读完
items.forEach((item, i) => {
  item.style.width = widths[i] + 10 + 'px'  // 再统一写
})
```

---

## 分层与合成（Compositing）

并非所有节点都平铺在同一层，浏览器会把特定节点**提升到独立的合成层**（Compositing Layer）。这些层由 GPU 单独处理，不参与 CPU 的 Layout 和 Paint，更新时只需 GPU 重新合成。

### 什么会创建合成层

- `transform: translateZ(0)` 或 `will-change: transform`
- `position: fixed`
- `<video>`、`<canvas>`、`<iframe>`
- `opacity` 动画（当使用 CSS transition/animation 时）

### 为什么 transform 动画比 top/left 快

用 `top` 移动元素：

```
修改 top → 触发 Layout → 触发 Paint → 触发 Composite
```

用 `transform: translateX()` 移动元素：

```
修改 transform → 触发 Composite（只有这一步！）
```

`transform` 和 `opacity` 的动画**完全跳过了 Layout 和 Paint**，由 GPU 直接处理，这就是它们性能好的原因。

:::caution[合成层不是越多越好]
每个合成层都占用 GPU 显存。过度使用 `will-change` 或 `translateZ(0)` 会让显存耗尽，在移动端尤其明显，反而导致更卡。只在**有动画且确实卡顿**的元素上使用。
:::

### 如何查看分层情况

Chrome DevTools → Layers 面板，可以直观看到页面有哪些合成层以及创建原因。

---

## Event Loop：JS 与渲染的调度

浏览器主线程只有一个，JS 执行和页面渲染在**同一个线程**上交替进行。Event Loop 是调度这一切的核心机制。

### 任务队列

Event Loop 每次循环（tick）的完整流程：

```
1. 取出一个宏任务（Macro Task）执行
2. 清空所有微任务队列（Micro Task）
3. 如果需要渲染（16.7ms 一帧）：
   a. requestAnimationFrame 回调
   b. Layout → Paint → Composite
4. 回到第 1 步
```

**宏任务**：`setTimeout`、`setInterval`、`I/O`、`MessageChannel`、`postMessage`

**微任务**：`Promise.then`、`queueMicrotask`、`MutationObserver`

```ts
console.log('1')

setTimeout(() => console.log('4'), 0)  // 宏任务，放到下一轮

Promise.resolve()
  .then(() => console.log('2'))  // 微任务，当前轮 tick 结束前执行
  .then(() => console.log('3'))  // 微任务链

// 输出顺序：1 → 2 → 3 → 4
```

### 微任务会延迟渲染

微任务队列未清空前，渲染不会发生。如果在 Promise 链里无限添加微任务，页面将永远无法渲染：

```ts
// ❌ 页面冻结：微任务不断产生，渲染被无限推迟
function loop() {
  Promise.resolve().then(loop)
}
loop()

// ✅ setTimeout 是宏任务，每轮循环后都能插入渲染帧
function loop() {
  setTimeout(loop, 0)
}
```

### requestAnimationFrame 的正确用法

`rAF` 回调在**每帧渲染前**执行，是做动画最合适的时机：

```ts
function animate(timestamp: number) {
  // timestamp 是高精度时间戳（毫秒）
  element.style.transform = `translateX(${timestamp * 0.1 % 500}px)`
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)
```

用 `rAF` 做动画比 `setInterval` 的优势：
- 帧率与屏幕刷新率同步（60fps / 120fps 自适应）
- 页面不可见时自动暂停，不浪费 CPU
- 在渲染前执行，避免中间帧被浪费

### Long Task 与 scheduler.yield

超过 50ms 的任务会阻塞渲染，用 `scheduler.yield` 可以主动让出主线程：

```ts
async function processLargeList(items: unknown[]) {
  for (let i = 0; i < items.length; i++) {
    process(items[i])

    // 每处理 100 条让出一次主线程，允许渲染帧插入
    if (i % 100 === 0) {
      await yieldToMain()
    }
  }
}
```

`scheduler.yield` 目前只有 Chrome 129+ 支持，Firefox 和 Safari 尚未实现。生产环境封装一个兼容函数：

```ts
function yieldToMain(): Promise<void> {
  // scheduler.yield 优先：让出优先级更精确，能保证在下一个渲染帧前恢复
  if ('scheduler' in globalThis && 'yield' in scheduler) {
    return scheduler.yield()
  }
  // MessageChannel 比 setTimeout 延迟更低（setTimeout 最小 ~4ms，MessageChannel ~0ms）
  return new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => resolve()
    port2.postMessage(null)
  })
}
```

:::note[为什么不直接用 setTimeout(fn, 0)]
`setTimeout` 在嵌套调用时会被浏览器强制加上最小 4ms 延迟（HTML 规范要求）。循环中频繁让出时，`MessageChannel` 的延迟更低，更接近「仅跳过当前任务」的语义。`scheduler.yield` 则额外支持优先级传递（继承调用者的优先级），是三者中最精准的。
:::

---

## V8 内存管理

### 堆内存分区

V8 把堆内存分为几个区域：

```
堆内存
├── 新生代（Young Generation）  ~1-8MB
│   ├── From Space（活跃对象）
│   └── To Space（GC 目标区）
└── 老生代（Old Generation）    ~几百MB
    ├── Old Space（长期存活的对象）
    ├── Code Space（JIT 编译后的代码）
    └── Large Object Space（超大对象）
```

### 新生代 GC：Scavenge

新建的对象先进入新生代 From Space。GC 触发时，将 From Space 中**存活**的对象复制到 To Space，然后交换两个区域的角色（From ↔ To）。复制完成后 From Space 全部清空，因此不会有内存碎片。

存活超过两次 GC 的对象晋升到老生代。

### 老生代 GC：标记清除 + 标记整理

老生代体积大，用**三色标记**（白/灰/黑）遍历对象图：

- 白：未访问，GC 结束后仍为白 = 可回收
- 灰：已发现但子节点未扫描
- 黑：已完全扫描，不可回收

为了避免 GC 暂停（Stop-the-World），V8 使用**增量标记**：把标记阶段拆成小片，穿插在 JS 执行之间，每次只标记一部分。配合**并发标记**（在辅助线程上并行标记），大幅缩短了主线程暂停时间。

### 内存泄漏的常见原因

```ts
// 1. 意外的全局变量
function leak() {
  // 没有 let/const/var，创建了全局变量
  leakedData = new Array(1000000)
}

// 2. 未清理的事件监听
class Component {
  mount() {
    window.addEventListener('resize', this.onResize)
  }
  // ❌ 没有 unmount，监听一直存在，this 无法被回收
}

// 3. 定时器持有引用
const data = { /* 大量数据 */ }
setInterval(() => {
  console.log(data)  // data 被 interval 引用，永不释放
}, 1000)
// 如果 setInterval 没有被清理，data 永远不会被 GC

// 4. 闭包持有大对象
function createHandler() {
  const largeBuffer = new ArrayBuffer(50 * 1024 * 1024)
  return () => {
    // 只用到 largeBuffer 的一小部分
    return new Uint8Array(largeBuffer)[0]
  }
}
```

**检测工具**：Chrome DevTools → Memory → Heap Snapshot，对比两个快照，过滤 `Detached` 节点（已从 DOM 移除但仍被 JS 引用的节点）。

---

## 渲染性能的底层逻辑

回到最开始：理解了管线，很多性能优化原则就不需要死记硬背了。

| 优化手段 | 底层原因 |
|---------|---------|
| `transform` 代替 `top/left` 做动画 | 跳过 Layout 和 Paint，只触发 Composite |
| 避免读写交替触发的强制布局 | 读取几何属性会强制同步 Layout |
| 用 `rAF` 做动画 | 与渲染帧对齐，不浪费中间帧 |
| 长任务用 `scheduler.yield` 拆分 | 让出主线程，允许渲染帧插入 |
| CSS 选择器不要太长 | 减少样式计算（右到左匹配）的回溯深度 |
| `will-change` 适度使用 | 提升为合成层可跳过 Paint，但占显存 |
| `<script defer>` | 不阻塞解析，DOMContentLoaded 前执行 |
| 关键 CSS 内联 | 消除首次渲染的 CSS 下载等待 |
| 避免 JS 内存泄漏 | 减少 GC 频率，降低 GC 暂停引起的掉帧 |

:::note[关联阅读]
本文关注的是浏览器的"为什么"。具体的工程优化手段（Bundle 分包、虚拟列表、HTTP 缓存策略等）参见[前端性能优化全景](/post/performance/optimization)；Worker 和 WASM 的多线程卸载方案参见[突破浏览器主线程瓶颈](/post/performance/worker-wasm)。
:::
