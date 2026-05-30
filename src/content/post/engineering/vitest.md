---
title: "Vitest 单元测试实战"
description: "从零配置 Vitest，覆盖纯函数测试、Vue 组件测试（Vue Test Utils）、异步逻辑、Mock 模块与网络请求，到测试覆盖率采集与 CI 集成，建立前端工程化体系中完整的测试链路"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["测试", "Vitest", "Vue Test Utils", "工程实践", "CI"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Vitest 单元测试实战

前端项目里测试缺失的理由通常是「业务变化太快，测试跟不上」。但这个逻辑反过来也成立：**正是因为业务变化快，才更需要测试来保障重构时不引入回归。**

Vitest 是 Vite 生态的测试框架，与 Jest API 基本兼容，但无需单独配置 transform，复用 Vite 配置，冷启动比 Jest 快数倍，是 Vue 3 + Vite 项目的首选。

---

## 环境搭建

```bash
pnpm add -D vitest @vue/test-utils @vitejs/plugin-vue jsdom
```

```ts title="vite.config.ts"
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',    // 模拟浏览器 DOM 环境
    globals: true,           // 全局注入 describe / it / expect，无需每个文件 import
    setupFiles: ['./src/test/setup.ts'],  // 全局初始化文件
  },
})
```

```ts title="src/test/setup.ts"
import { config } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// 全局注册组件库，避免每个测试文件重复注册
config.global.plugins = [ElementPlus]
```

```json title="package.json"
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",          // 单次运行（CI 用）
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## 纯函数测试

最简单也最有价值的测试，无副作用，输入确定则输出确定。

```ts title="src/utils/format.ts"
export function formatPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key])
    ;(acc[k] ??= []).push(item)
    return acc
  }, {} as Record<string, T[]>)
}
```

```ts title="src/utils/format.test.ts"
import { describe, it, expect } from 'vitest'
import { formatPrice, clamp, groupBy } from './format'

describe('formatPrice', () => {
  it('将分转换为元并格式化', () => {
    expect(formatPrice(9900)).toBe('¥99.00')
    expect(formatPrice(100)).toBe('¥1.00')
    expect(formatPrice(1)).toBe('¥0.01')
  })

  it('处理整数元', () => {
    expect(formatPrice(10000)).toBe('¥100.00')
  })
})

describe('clamp', () => {
  it('值在范围内时原样返回', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('小于最小值时返回最小值', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
  })

  it('大于最大值时返回最大值', () => {
    expect(clamp(100, 0, 10)).toBe(10)
  })
})

describe('groupBy', () => {
  const items = [
    { type: 'fruit', name: 'apple' },
    { type: 'veggie', name: 'carrot' },
    { type: 'fruit', name: 'banana' },
  ]

  it('按指定字段分组', () => {
    const result = groupBy(items, 'type')
    expect(result.fruit).toHaveLength(2)
    expect(result.veggie).toHaveLength(1)
    expect(result.fruit[0].name).toBe('apple')
  })
})
```

### 常用 Matcher

```ts
// 相等
expect(a).toBe(b)          // 严格相等（===）
expect(a).toEqual(b)       // 深度相等（对象/数组用这个）
expect(a).not.toBe(b)      // 取反

// 真假
expect(a).toBeTruthy()
expect(a).toBeFalsy()
expect(a).toBeNull()
expect(a).toBeUndefined()

// 数字
expect(n).toBeGreaterThan(0)
expect(n).toBeCloseTo(3.14, 2)  // 浮点比较

// 字符串
expect(s).toContain('hello')
expect(s).toMatch(/^hello/)

// 数组
expect(arr).toHaveLength(3)
expect(arr).toContain('item')
expect(arr).toEqual(expect.arrayContaining(['a', 'b']))

// 对象
expect(obj).toHaveProperty('name', 'Alice')
expect(obj).toMatchObject({ name: 'Alice' })  // 只验证部分字段

// 函数调用（配合 Mock）
expect(fn).toHaveBeenCalled()
expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
expect(fn).toHaveBeenCalledTimes(2)
```

---

## Vue 组件测试

### 挂载组件

```ts title="src/components/Counter.test.ts"
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Counter from './Counter.vue'

describe('Counter', () => {
  it('初始值为 0', () => {
    const wrapper = mount(Counter)
    expect(wrapper.text()).toContain('0')
  })

  it('点击 + 按钮后值加 1', async () => {
    const wrapper = mount(Counter)
    await wrapper.find('[data-test="increment"]').trigger('click')
    expect(wrapper.text()).toContain('1')
  })

  it('接受 initialValue prop', () => {
    const wrapper = mount(Counter, {
      props: { initialValue: 10 },
    })
    expect(wrapper.text()).toContain('10')
  })
})
```

:::tip[用 data-test 属性定位元素]
测试中用 `data-test="xxx"` 而不是 CSS 类名定位元素。类名是样式关注点，会随 UI 调整频繁变化；`data-test` 只为测试存在，修改样式时不会意外破坏测试。生产构建时可用插件自动移除这些属性。
:::

### 测试 emit 事件

```ts title="src/components/SearchBar.test.ts"
it('输入后触发 search 事件', async () => {
  const wrapper = mount(SearchBar)
  const input = wrapper.find('input')

  await input.setValue('hello world')
  await input.trigger('keydown.enter')

  // emitted('search') 返回二维数组：外层每个元素对应一次 emit 调用，
  // 内层数组是该次调用传入的参数列表。
  // 例如 emit('search', 'hello') 触发两次后：
  // [['hello'], ['world']]
  //   ^第1次     ^第2次
  const calls = wrapper.emitted('search')
  expect(calls).toHaveLength(1)             // 只触发了一次
  expect(calls![0]).toEqual(['hello world']) // 第一次调用的参数列表
})
```

### 测试插槽

```ts title="src/components/Card.test.ts"
it('渲染默认插槽内容', () => {
  const wrapper = mount(Card, {
    slots: {
      default: '<p class="slot-content">插槽内容</p>',
      header: '<h2>标题</h2>',
    },
  })

  expect(wrapper.find('.slot-content').exists()).toBe(true)
  expect(wrapper.find('h2').text()).toBe('标题')
})
```

### 测试 Pinia Store

```ts title="src/stores/cart.test.ts"
import { setActivePinia, createPinia } from 'pinia'
import { useCartStore } from './cart'

describe('useCartStore', () => {
  beforeEach(() => {
    // 每个测试前创建新的 Pinia 实例，避免状态污染
    setActivePinia(createPinia())
  })

  it('添加商品到购物车', () => {
    const cart = useCartStore()
    cart.addItem({ id: 1, name: '商品A', price: 100 })

    expect(cart.items).toHaveLength(1)
    expect(cart.total).toBe(100)
  })

  it('重复添加同一商品增加数量', () => {
    const cart = useCartStore()
    cart.addItem({ id: 1, name: '商品A', price: 100 })
    cart.addItem({ id: 1, name: '商品A', price: 100 })

    expect(cart.items).toHaveLength(1)
    expect(cart.items[0].quantity).toBe(2)
  })
})
```

---

## 异步测试

### 测试 async/await

```ts title="src/composables/useUser.test.ts"
import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock 整个模块
vi.mock('../api/user', () => ({
  fetchUser: vi.fn().mockResolvedValue({
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
  }),
}))

import { useUser } from './useUser'
import { fetchUser } from '../api/user'

describe('useUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('加载用户数据', async () => {
    const { user, loading, load } = useUser()

    expect(loading.value).toBe(false)

    const promise = load(1)
    expect(loading.value).toBe(true)

    await promise

    expect(loading.value).toBe(false)
    expect(user.value?.name).toBe('Alice')
    expect(fetchUser).toHaveBeenCalledWith(1)
  })

  it('加载失败时 error 有值', async () => {
    vi.mocked(fetchUser).mockRejectedValueOnce(new Error('网络错误'))

    const { error, load } = useUser()
    await load(1)

    expect(error.value?.message).toBe('网络错误')
  })
})
```

### 测试定时器

```ts
import { vi } from 'vitest'

it('防抖函数 300ms 后只执行一次', () => {
  vi.useFakeTimers()          // 接管 setTimeout / setInterval

  const fn = vi.fn()
  const debounced = debounce(fn, 300)

  debounced('a')
  debounced('b')
  debounced('c')

  expect(fn).not.toHaveBeenCalled()  // 还没到 300ms

  vi.advanceTimersByTime(300)        // 快进 300ms

  expect(fn).toHaveBeenCalledTimes(1)
  expect(fn).toHaveBeenCalledWith('c')

  vi.useRealTimers()          // 恢复真实定时器
})
```

---

## Mock 技巧

### vi.mock 模块替换

```ts
// mock 整个模块，所有导出都变成 vi.fn()
vi.mock('../api/order')

// mock 部分导出，保留其他
vi.mock('../api/order', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/order')>()
  return {
    ...actual,
    // 只替换 deleteOrder，其他保持原实现
    deleteOrder: vi.fn().mockResolvedValue({ success: true }),
  }
})
```

### 模拟网络请求：msw

[msw](https://mswjs.io/)（Mock Service Worker）拦截真实的 `fetch` / `axios` 请求，比 mock 模块更接近真实行为：

```ts title="src/test/handlers.ts"
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/users/:id', ({ params }) => {
    return HttpResponse.json({
      id: params.id,
      name: 'Alice',
    })
  }),

  http.post('/api/orders', async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 'order-123', ...body }, { status: 201 })
  }),
]
```

```ts title="src/test/setup.ts"
import { setupServer } from 'msw/node'
import { handlers } from './handlers'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

```ts title="src/api/user.test.ts"
import { server } from '../test/setup'
import { http, HttpResponse } from 'msw'

it('处理 404 错误', async () => {
  // 单个测试覆盖 handler
  server.use(
    http.get('/api/users/:id', () => {
      return HttpResponse.json({ message: 'Not Found' }, { status: 404 })
    })
  )

  const { error } = await getUser(999)
  expect(error.code).toBe(404)
})
```

### 模拟 localStorage / sessionStorage

```ts
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(window, 'localStorage', { value: localStorageMock })
```

---

## 测试覆盖率

```bash
pnpm test:coverage
```

```ts title="vite.config.ts"
test: {
  coverage: {
    provider: 'v8',         // 或 'istanbul'
    reporter: ['text', 'html', 'lcov'],
    include: ['src/**/*.{ts,vue}'],
    exclude: ['src/test/**', 'src/**/*.d.ts', 'src/main.ts'],
    thresholds: {
      lines: 80,
      functions: 80,
      branches: 70,
    },
  },
}
```

覆盖率报告说明：

| 指标 | 含义 |
|------|------|
| Statements | 代码语句覆盖率 |
| Branches | 分支覆盖率（if/else 每个分支） |
| Functions | 函数覆盖率 |
| Lines | 行覆盖率 |

:::caution[覆盖率不等于质量]
80% 覆盖率可能全是 `expect(fn).not.toThrow()` 这种无意义的断言。关注**关键路径**和**边界条件**的测试质量，比追求覆盖率数字更有价值。复杂的业务逻辑、数据转换函数、错误处理分支是测试的优先目标。
:::

---

## CI 集成

```yaml title=".github/workflows/test.yml"
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      # test:coverage 内部会跑完整的测试套件，无需单独再跑 test:run
      - run: pnpm test:coverage
      # 上传覆盖率报告到 Codecov（可选）
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
```

:::tip[在 PR 中看到覆盖率变化]
配合 Codecov 或 Coveralls，每个 PR 会自动评论覆盖率变化情况，方便 review 时判断新代码是否有足够的测试覆盖。
:::

---

## 什么值得测，什么不值得测

实际项目里不需要 100% 覆盖，把精力放在收益最高的地方：

| 值得测 | 理由 |
|--------|------|
| 纯函数（工具函数、数据转换） | 输入输出明确，测试稳定 |
| 复杂业务逻辑（计算、校验规则） | 容易在重构时悄悄出错 |
| Pinia Store 的 actions / getters | 状态管理是业务核心 |
| 关键 composable 的异常处理 | 错误分支最容易被遗漏 |

| 不值得测 | 理由 |
|--------|------|
| 纯展示组件（只有 props → 模板） | 样式变化频繁，维护成本高 |
| 第三方库的行为 | 库自己有测试，不需要重复测 |
| 简单的 getter（直接返回 state） | 没有逻辑，测试价值低 |
| 路由跳转、页面跳转 | 更适合 E2E 测试（Playwright） |
