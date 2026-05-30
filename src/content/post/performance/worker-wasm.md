---
title: "Web Worker 与 WebAssembly"
description: "从 JS 单线程限制出发，深度拆解 Web Worker 的通信模型、Transferable 零拷贝传输、SharedArrayBuffer 共享内存，再到 WebAssembly 的编译工具链、JS 互操作与性能边界，最后落地到 Worker + WASM 组合的真实应用场景"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["性能优化", "Web Worker", "WebAssembly", "多线程", "WASM"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Web Worker 与 WebAssembly：突破浏览器主线程瓶颈

前端性能优化的常规手段——懒加载、分包、缓存——本质上都是减少需要做的工作量。但如果工作本身无法压缩，比如解析一个 10MB 的 JSON、实时压缩视频帧、跑一个机器学习推理，这些手段就到了边界。

这时真正的瓶颈是 **JS 单线程**。浏览器给每个页面一个主线程，它既要执行 JS，又要响应用户交互，还要驱动渲染。一旦主线程被计算任务占用超过 50ms，用户就会感知到卡顿（Long Task）。

Web Worker 和 WebAssembly 是绕过这个瓶颈的两条路：

- **Web Worker**：把计算任务移到独立线程，主线程继续响应交互
- **WebAssembly**：用接近原生的执行速度跑 CPU 密集计算

---

## Web Worker

### 为什么需要 Worker

JS 的事件循环模型决定了：任何同步代码都会阻塞主线程，直到执行完毕才能处理下一个任务（渲染帧、用户点击等）。

```
主线程时间线：
[渲染帧] [用户点击] [执行 JS 100ms] ← 这 100ms 内页面无响应
```

Chrome DevTools Performance 面板中，超过 50ms 的任务会被标红为 Long Task，正是这类场景。

```ts
// 模拟阻塞主线程 2 秒的计算
function heavyCompute() {
  let sum = 0;
  for (let i = 0; i < 2_000_000_000; i++) {
    sum += i;
  }
  return sum;
}

// 调用这个函数期间，页面上的动画停止，按钮无法点击
heavyCompute();
```

Web Worker 的解法是在 **独立线程** 里跑这段计算，主线程只负责收结果：

```
主线程：[渲染帧] [用户点击] [渲染帧] [收到 Worker 结果] [更新 UI]
Worker：              [heavyCompute 运行 2s .........]
```

### 基础用法

**创建 Worker**：

```ts title="worker.ts"
// Worker 线程代码
self.onmessage = (event) => {
  const { data } = event;
  const result = heavyCompute(data);
  self.postMessage(result);
};

function heavyCompute(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}
```

```ts title="main.ts"
// 主线程
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

worker.onmessage = (event) => {
  console.log("计算结果:", event.data);
};

worker.postMessage(2_000_000_000);
```

**在 Vite 项目中**，用 `?worker` 后缀导入，Vite 会自动处理打包：

```ts title="main.ts"
import ComputeWorker from "./worker?worker";

const worker = new ComputeWorker();
worker.postMessage(2_000_000_000);
```

### 通信机制

Worker 和主线程之间通过 `postMessage` / `onmessage` 传递消息。**默认情况下数据会被深拷贝**（结构化克隆算法），这意味着：

- 传 1MB 的对象：主线程序列化 + Worker 反序列化，两端各有一份副本
- 传 100MB 的 ArrayBuffer：拷贝 200MB 的数据，代价相当高

:::warning[大数据传输的陷阱]
用 Worker 处理大数据时，如果忽视传输成本，Worker 本身节省的时间可能还不如传输消耗的时间多。1MB 以上的数据要考虑 Transferable Objects。
:::

### Transferable Objects：零拷贝传输

`ArrayBuffer`、`MessagePort`、`ImageBitmap` 等对象支持**转移所有权**，传输后原始端的引用失效，不产生拷贝：

```ts title="main.ts"
// 生成 100MB 的 Buffer
const buffer = new ArrayBuffer(100 * 1024 * 1024);

// 第二个参数是 transfer list，标记需要转移所有权的对象
worker.postMessage({ buffer }, [buffer]);

// 转移后，buffer 不可再用（byteLength 变为 0）
console.log(buffer.byteLength); // 0
```

```ts title="worker.ts"
self.onmessage = (event) => {
  const { buffer } = event.data;
  // Worker 拿到了原始内存，没有任何拷贝
  const view = new Uint8Array(buffer);
  // ... 处理 ...
  // 处理完再转回去
  self.postMessage({ buffer }, [buffer]);
};
```

**结构化克隆 vs Transferable 对比**：

| 方式         | 拷贝         | 原始端   | 适用场景                   |
| ------------ | ------------ | -------- | -------------------------- |
| 结构化克隆   | 是，完整拷贝 | 仍然可用 | 数据量小，双方都需要副本   |
| Transferable | 否，零拷贝   | 失效     | 大型 ArrayBuffer，单向传递 |

### SharedArrayBuffer：真正的共享内存

Transferable 解决了传输成本，但双方还是轮流持有。`SharedArrayBuffer` 让主线程和 Worker **同时访问同一块内存**：

```ts title="main.ts"
// 创建 4 字节共享内存
const sab = new SharedArrayBuffer(4);
const view = new Int32Array(sab);

// 发给 Worker，不是转移而是共享，双方都能读写
worker.postMessage({ sab });

// 主线程修改
view[0] = 42;
```

```ts title="worker.ts"
self.onmessage = (event) => {
  const view = new Int32Array(event.data.sab);
  // 直接读到主线程写入的值
  console.log(view[0]); // 42
};
```

共享内存会引入**竞争条件**，用 `Atomics` 保证原子操作：

```ts
// 原子性地给 view[0] 加 1，避免多线程写入冲突
Atomics.add(view, 0, 1);

// 用于线程间同步等待（Worker 等待主线程通知）
Atomics.wait(view, 0, 0); // 阻塞直到 view[0] 不等于 0
Atomics.notify(view, 0, 1); // 通知等待中的线程
```

:::note[SharedArrayBuffer 的安全限制]
SharedArrayBuffer 要求页面开启 **跨源隔离**（Cross-Origin Isolation），需要服务端返回以下响应头：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

这会影响第三方脚本加载，需要评估后再启用。
:::

### Worker 池

单个 Worker 是串行处理任务的。任务多时用 **Worker 池** 并行消费：

```ts title="worker-pool.ts"
class WorkerPool {
  private workers: Worker[] = []
  private queue: Array<{ data: unknown; resolve: (v: unknown) => void }> = []
  // 记录每个 Worker 当前对应的 resolve，为空表示空闲
  private pending = new Map<Worker, (v: unknown) => void>()

  constructor(workerUrl: URL, size = navigator.hardwareConcurrency) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(workerUrl, { type: 'module' })
      w.onmessage = (e) => {
        // 通知等待该 Worker 结果的调用方
        this.pending.get(w)?.(e.data)
        this.pending.delete(w)
        // 继续消费队列
        const next = this.queue.shift()
        if (next) {
          this.pending.set(w, next.resolve)
          w.postMessage(next.data)
        }
        // 无队列任务时 pending 中无此 Worker，视为空闲
      }
      this.workers.push(w)
    }
  }

  run(data: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const worker = this.workers.find(w => !this.pending.has(w))
      if (worker) {
        this.pending.set(worker, resolve)
        worker.postMessage(data)
      } else {
        this.queue.push({ data, resolve })
      }
    })
  }
}
```

:::tip[池大小的经验值]
`navigator.hardwareConcurrency` 返回逻辑 CPU 核心数。CPU 密集型任务用核心数作为池大小；IO 密集型（较少见于 Worker 场景）可以适当超配。
:::

### 真实场景：大文件解析

上传一个 50MB 的 CSV 文件，在主线程解析会卡死 UI：

```ts title="csv-worker.ts"
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  const text = new TextDecoder().decode(event.data);
  const lines = text.split("\n");
  const headers = lines[0].split(",");

  const rows = lines.slice(1).map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, values[i]]));
  });

  self.postMessage(rows);
};
```

```ts title="upload.ts"
import CsvWorker from "./csv-worker?worker";

async function parseCSV(file: File) {
  const buffer = await file.arrayBuffer();
  const worker = new CsvWorker();

  return new Promise<Record<string, string>[]>((resolve) => {
    worker.onmessage = (e) => {
      resolve(e.data);
      worker.terminate();
    };
    // 零拷贝传输 ArrayBuffer
    worker.postMessage(buffer, [buffer]);
  });
}
```

---

## WebAssembly

### WASM 是什么

WebAssembly 是一种二进制指令格式，专为浏览器设计的低级虚拟机指令集。它不是新的编程语言，而是**编译目标**：

```
C / C++ / Rust / Go
        ↓ 编译
    .wasm 二进制文件
        ↓ 加载
    浏览器 WASM 虚拟机
```

WASM 的设计目标是**接近原生性能**：无 GC 暂停、静态类型、线性内存模型，适合 CPU 密集型计算。

**JS 与 WASM 的性能差距在哪里**：

| 特性     | JavaScript             | WebAssembly          |
| -------- | ---------------------- | -------------------- |
| 类型     | 动态类型，运行时推断   | 静态类型，编译时确定 |
| 内存管理 | GC，有暂停             | 手动管理线性内存     |
| 编译     | JIT，有热身期          | AOT，首次执行即最优  |
| 数字运算 | 通过 V8 优化，接近原生 | 直接映射 CPU 指令    |

:::note[WASM 不总是比 JS 快]
WASM 在**纯数值计算**上优势明显，但在涉及 DOM 操作、JS 对象交互时，跨边界调用有开销。对字符串、对象频繁操作的场景，用 WASM 反而可能更慢。
:::

### 从 Rust 编译 WASM

Rust 是目前 WASM 生态最成熟的语言，`wasm-pack` 工具链可直接生成可供 JS 调用的 npm 包：

```bash
# 安装工具链
cargo install wasm-pack

# 新建 Rust 项目
cargo new --lib my-wasm-lib
```

```toml title="Cargo.toml"
[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
```

```rust title="src/lib.rs"
use wasm_bindgen::prelude::*;

// #[wasm_bindgen] 标记暴露给 JS 的函数
#[wasm_bindgen]
pub fn fibonacci(n: u32) -> u32 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}

#[wasm_bindgen]
pub fn sum_array(arr: &[f64]) -> f64 {
    arr.iter().sum()
}
```

```bash
# 编译为 WASM + JS 胶水代码
wasm-pack build --target web
```

编译产物：

```
pkg/
  my_wasm_lib_bg.wasm   ← 二进制
  my_wasm_lib.js        ← JS 胶水层（处理类型转换）
  my_wasm_lib.d.ts      ← TypeScript 类型
```

**在 Vite 项目中使用**：

```ts title="main.ts"
import init, { fibonacci, sum_array } from "./pkg/my_wasm_lib.js";

// WASM 需要异步初始化（下载 + 编译 .wasm 文件）
await init();

console.log(fibonacci(40)); // ~102334155，毫秒级完成

const arr = new Float64Array([1, 2, 3, 4, 5]);
console.log(sum_array(arr)); // 15
```

### 内存模型与数据交换

WASM 使用**线性内存**（一段连续的 ArrayBuffer），JS 和 WASM 通过这段内存交换数据：

```ts
// 获取 WASM 内存视图
const memory = new Uint8Array(wasmInstance.exports.memory.buffer);

// WASM 函数返回内存中的偏移量，JS 从那里读取数据
const ptr = wasmInstance.exports.get_result();
const len = wasmInstance.exports.get_result_len();
const result = memory.slice(ptr, ptr + len);
```

这就是为什么 `wasm-bindgen` 如此重要——它自动生成了这层胶水代码，开发者不需要手动管理指针偏移。

### 使用现有 WASM 库

很多场景不需要自己写 Rust，直接用现成的 WASM 编译版本：

**图片压缩**（`browser-image-compression`，内部使用 WASM）：

```ts
import imageCompression from 'browser-image-compression'

const compressed = await imageCompression(file, {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,   // 内部自动在 Worker 中调用 WASM 压缩
})

const url = URL.createObjectURL(compressed)
```

**SQLite in Browser**（`sql.js`）：

```ts
import initSqlJs from "sql.js";

const SQL = await initSqlJs({
  locateFile: (file) => `/wasm/${file}`,
});

const db = new SQL.Database();
db.run("CREATE TABLE users (id INTEGER, name TEXT)");
db.run('INSERT INTO users VALUES (1, "Alice"), (2, "Bob")');

const result = db.exec("SELECT * FROM users");
console.log(result[0].values); // [[1, 'Alice'], [2, 'Bob']]
```

**PDF 解析**（`pdfjs-dist`）、**视频解码**（`ffmpeg.wasm`）、**加密运算**（`libsodium-wrappers`）都有成熟的 WASM 版本可以直接使用。

### 性能对比：何时值得用 WASM

以图像灰度化为例，对比 JS 和 WASM 的处理速度（1920×1080 图像）：

```ts
// JS 版本
function grayscaleJS(imageData: ImageData) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    data[i] = data[i + 1] = data[i + 2] = avg;
  }
}

// WASM 版本（Rust 实现，编译后调用）
// grayscaleWasm(imageData.data.buffer)
```

| 场景           | JS 耗时 | WASM 耗时 | 提升         |
| -------------- | ------- | --------- | ------------ |
| 1080p 灰度化   | ~80ms   | ~15ms     | 5x           |
| Fibonacci(45)  | ~9s     | ~2s       | 4.5x         |
| AES 加密 10MB  | ~200ms  | ~40ms     | 5x           |
| JSON.parse 1MB | ~5ms    | ~8ms      | -（JS 更快） |

:::caution[WASM 不适合所有场景]
频繁的 JS↔WASM 边界调用有固定开销。如果算法需要在 JS 和 WASM 之间反复传递数据，总开销可能超过纯 JS。适合 WASM 的场景是：**一次传入数据，内部大量计算，一次返回结果**。
:::

---

## Worker + WASM 组合

两者的优势叠加：Worker 解决线程阻塞，WASM 解决计算速度。

```
主线程 → postMessage(data) → Worker 线程
                                    ↓
                            加载 WASM 模块
                                    ↓
                            WASM 高速计算
                                    ↓
主线程 ← postMessage(result) ←
```

**实际案例：Worker 中运行 FFmpeg WASM 转码**

```ts title="ffmpeg-worker.ts"
import { createFFmpeg, fetchFile } from "@ffmpeg/ffmpeg";

const ffmpeg = createFFmpeg({ log: false });

self.onmessage = async (
  event: MessageEvent<{ file: ArrayBuffer; name: string }>,
) => {
  const { file, name } = event.data;

  if (!ffmpeg.isLoaded()) {
    await ffmpeg.load();
  }

  ffmpeg.FS("writeFile", name, new Uint8Array(file));

  await ffmpeg.run("-i", name, "-c:v", "libx264", "-crf", "23", "output.mp4");

  const output = ffmpeg.FS("readFile", "output.mp4");

  // 转移所有权，零拷贝返回
  self.postMessage({ result: output.buffer }, [output.buffer]);
};
```

```ts title="transcode.ts"
import FFmpegWorker from "./ffmpeg-worker?worker";

export async function transcodeVideo(file: File): Promise<Blob> {
  const buffer = await file.arrayBuffer();
  const worker = new FFmpegWorker();

  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const blob = new Blob([e.data.result], { type: "video/mp4" });
      resolve(blob);
      worker.terminate();
    };
    worker.onerror = reject;
    worker.postMessage({ file: buffer, name: file.name }, [buffer]);
  });
}
```

整个转码过程在 Worker 线程内完成，主线程全程可交互。

---

## 适用场景判断

不是所有计算都需要 Worker 或 WASM，判断依据：

**用 Web Worker 的信号**：

- 任务单次耗时 > 50ms（Long Task 的阈值）
- 计算结果不需要实时同步到 UI（异步返回即可）
- 场景：大文件解析、数据聚合、加密/解密、图像处理预处理

**用 WebAssembly 的信号**：

- CPU 密集型数值计算（大量循环、浮点运算）
- 已有成熟的 C/C++/Rust 实现，不想用 JS 重写
- 对性能有明确的数值要求（如 < 16ms 才不丢帧）

**既用 Worker 又用 WASM 的信号**：

- 计算量大 + 不能阻塞 UI（最常见的组合）
- 音视频处理、实时图像滤镜、大规模数据计算

**不需要这两者的情况**：

| 情况             | 原因                              |
| ---------------- | --------------------------------- |
| 计算 < 10ms      | 开销不值得，Worker 创建本身有代价 |
| 需要频繁访问 DOM | Worker 无法访问 DOM               |
| 简单 CRUD 类逻辑 | 完全无需计算卸载                  |

:::tip[先量化，再优化]
用 `performance.mark` + `performance.measure` 或 DevTools Performance 面板确认计算确实是瓶颈。如果 Long Task 来自网络等待或 DOM 操作，引入 Worker/WASM 没有效果。
:::

---

## 小结

| 技术              | 解决的问题          | 核心代价                   | 代表场景                    |
| ----------------- | ------------------- | -------------------------- | --------------------------- |
| Web Worker        | 主线程阻塞          | 数据序列化/通信开销        | 大文件处理、数据聚合        |
| Transferable      | Worker 传输大数据慢 | 原始端引用失效             | 传 ArrayBuffer、ImageBitmap |
| SharedArrayBuffer | 多线程频繁共享数据  | 需要 COOP/COEP 响应头      | 实时计算、流式处理          |
| WebAssembly       | JS 计算速度不够     | 跨边界调用开销、工具链复杂 | 编解码、图像处理、密码学    |
| Worker + WASM     | 阻塞 + 速度双瓶颈   | 上面两者的叠加             | 视频转码、实时滤镜          |
