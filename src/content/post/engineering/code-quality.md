---
title: "写出好代码：TypeScript/JavaScript 编码习惯"
description: "从命名、函数设计、代码结构、注释到错误处理，通过反例与正例的对比，梳理让代码可读、可维护、可预测的核心习惯"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: ""
tags: ["TypeScript", "JavaScript", "代码质量", "工程实践", "最佳实践"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 写出好代码：TypeScript/JavaScript 编码习惯

好代码的标准只有一个：**下一个读这段代码的人（包括三个月后的自己）能快速理解它在做什么、为什么这么做**。

性能、简洁、聪明——这些都是次要的。可读性才是第一位的，因为代码被阅读的次数远多于被编写的次数。

本文通过反例与正例的对比，梳理五个核心维度的编码习惯。

---

## 一、命名：代码是写给人看的

命名是最廉价的文档。好的命名让读者不用看实现就知道意图。

### 变量命名：说清楚是什么

```ts
// ❌ 缩写 + 无意义单字母
const d = new Date()
const u = users.filter(u => u.a)
const res = await fetch('/api/data')

// ✅ 完整、准确描述含义
const today = new Date()
const activeUsers = users.filter(user => user.isActive)
const userListResponse = await fetch('/api/users')
```

临时变量也要有名字。`i`、`j` 只在 `for` 循环索引里可以接受，其他场景一律不用。

### 函数命名：动词 + 名词

函数是行为，名字里必须有动词：

```ts
// ❌ 名词，不知道做什么
function userData() {}
function password(str: string) {}
function modal() {}

// ✅ 动词 + 名词，意图清晰
function fetchUserData() {}
function validatePassword(str: string) {}
function openModal() {}
```

常用动词约定：
- **get / fetch**：获取数据（get 同步，fetch 通常异步）
- **set / update**：修改状态
- **create / build**：创建新对象
- **validate / check**：验证，返回布尔值
- **handle / on**：事件处理器
- **format / parse**：数据转换

### 布尔值：is / has / can 前缀

布尔变量和返回布尔的函数，加前缀让语义自明：

```ts
// ❌ 读到 if (loaded) 要往上找 loaded 是什么
let loaded = false
let admin = false
let error = true

// ✅ 读到 if (isLoaded) 含义立刻清楚
let isLoaded = false
let isAdmin = false
let hasError = true

// 函数也一样
function login() {}       // ❌ 返回什么？
function isLoggedIn() {}  // ✅ 返回 boolean
```

### 常量：全大写 SCREAMING_SNAKE_CASE

```ts
// ❌ 看起来像普通变量
const maxRetries = 3
const apiBaseUrl = 'https://api.example.com'

// ✅ 一眼看出是不变的配置值
const MAX_RETRIES = 3
const API_BASE_URL = 'https://api.example.com'
```

---

## 二、函数设计：一个函数只做一件事

### 单一职责：一件事的边界

判断方法：如果函数名里需要"和"、"并且"，就该拆分。

```ts
// ❌ 一个函数做了三件事
async function saveUserAndSendEmailAndLog(user: User) {
  await db.save(user)
  await sendWelcomeEmail(user.email)
  logger.info(`用户 ${user.id} 注册成功`)
}

// ✅ 拆开，各自职责清晰
async function saveUser(user: User) {
  await db.save(user)
}

async function sendWelcomeEmail(email: string) {
  await emailService.send(email, welcomeTemplate)
}

// 编排逻辑放到上层
async function registerUser(user: User) {
  await saveUser(user)
  await sendWelcomeEmail(user.email)
  logger.info(`用户 ${user.id} 注册成功`)
}
```

### 参数数量：超过 3 个就用对象

```ts
// ❌ 参数顺序容易搞错，调用时完全不知道每个值的含义
function createButton(label, size, color, disabled, loading) {}
createButton('提交', 'large', 'primary', false, true)

// ✅ 对象参数，调用时含义自明
interface ButtonOptions {
  label: string
  size?: 'small' | 'default' | 'large'
  color?: 'primary' | 'danger'
  disabled?: boolean
  loading?: boolean
}

function createButton(options: ButtonOptions) {}
createButton({ label: '提交', size: 'large', loading: true })
```

### 副作用：要么没有，要么显式

副作用本身不是坏事，但隐藏的副作用是 bug 的温床：

```ts
// ❌ 函数名暗示只是"格式化"，实际上修改了外部状态
function formatUser(user: User) {
  user.name = user.name.trim()    // 副作用：修改了入参
  user.updatedAt = new Date()     // 副作用：写入时间戳
  return user
}

// ✅ 方案一：纯函数，不修改入参
function formatUser(user: User): User {
  return {
    ...user,
    name: user.name.trim(),
  }
}

// ✅ 方案二：副作用不可避免时，函数名体现出来
function updateUserTimestamp(user: User) {
  user.updatedAt = new Date()
}
```

### 返回值：类型要一致

```ts
// ❌ 有时返回对象，有时返回 null，调用方每次都要判断
function findUser(id: string) {
  if (id === 'admin') return { name: 'Admin', role: 'admin' }
  if (!id) return null
  return undefined
}

// ✅ 返回类型统一，用 null 表示"找不到"
function findUser(id: string): User | null {
  if (!id) return null
  return users.get(id) ?? null
}
```

---

## 三、代码结构：让逻辑一眼看穿

### 提前返回：消灭嵌套

深层嵌套是可读性杀手。用提前返回（Guard Clause）把条件反转：

```ts
// ❌ 三层嵌套，主流程埋在最里面
function processOrder(order: Order) {
  if (order) {
    if (order.items.length > 0) {
      if (order.isPaid) {
        // 真正的逻辑在这里
        shipOrder(order)
      }
    }
  }
}

// ✅ 提前返回，主流程永远在最外层
function processOrder(order: Order) {
  if (!order) return
  if (order.items.length === 0) return
  if (!order.isPaid) return

  shipOrder(order)
}
```

### 把条件提取成命名变量

复合条件直接写在 `if` 里，读的时候要重新推理一遍。提取成变量，逻辑一目了然：

```ts
// ❌ 需要停下来推理这个条件在判断什么
if (user.role === 'admin' || (user.role === 'editor' && user.isActive && !user.isBanned)) {
  showDashboard()
}

// ✅ 条件本身有了名字，意图清晰
const isAdmin = user.role === 'admin'
const isActiveEditor = user.role === 'editor' && user.isActive && !user.isBanned
const canAccessDashboard = isAdmin || isActiveEditor

if (canAccessDashboard) {
  showDashboard()
}
```

### 相关逻辑放在一起

变量声明不要堆在函数顶部，用到的时候再声明，相关的代码块放在一起：

```ts
// ❌ 所有变量提前声明，阅读时要来回跳
function checkout(cartId: string) {
  let discount = 0
  let total = 0
  let tax = 0
  let finalAmount = 0

  const cart = getCart(cartId)
  const items = cart.items

  // ... 一大堆其他逻辑 ...

  discount = calculateDiscount(items)
  total = items.reduce((sum, item) => sum + item.price, 0)
  tax = total * 0.1
  finalAmount = total - discount + tax

  return finalAmount
}

// ✅ 就近声明，逻辑分组清晰
function checkout(cartId: string) {
  const cart = getCart(cartId)
  const items = cart.items

  const total = items.reduce((sum, item) => sum + item.price, 0)
  const discount = calculateDiscount(items)
  const tax = total * 0.1
  const finalAmount = total - discount + tax

  return finalAmount
}
```

### 魔法数字 / 魔法字符串：给它一个名字

```ts
// ❌ 3、86400000、'ACTIVE' 是什么含义？
if (retries > 3) throw new Error('超出重试次数')
const expiredAt = Date.now() + 86400000
if (user.status === 'ACTIVE') doSomething()

// ✅ 常量有名字，含义自文档化
const MAX_RETRIES = 3
const ONE_DAY_MS = 24 * 60 * 60 * 1000

type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BANNED'

if (retries > MAX_RETRIES) throw new Error('超出重试次数')
const expiredAt = Date.now() + ONE_DAY_MS
if (user.status === 'ACTIVE') doSomething()
```

---

## 四、注释：只写 why，不写 what

注释最大的误区是解释代码**在做什么**——这是代码本身该干的事，好的命名已经做到了。注释只应该解释**为什么这么做**。

### 不需要注释的情况

```ts
// ❌ 这行注释和代码完全重复，删掉不会损失任何信息
// 获取用户列表
const userList = await getUserList()

// ❌ 逻辑复杂是因为命名不好，不是需要注释的理由
// 判断是否有权限
if (user.role === 'admin' || (user.perms.includes('write') && !user.isLocked)) {}

// ✅ 改善命名，注释自然消失
const canEdit = user.role === 'admin' || (user.perms.includes('write') && !user.isLocked)
if (canEdit) {}
```

### 值得写注释的情况

```ts
// ✅ 解释非直觉的业务规则（why，不是 what）
// 后端要求金额以分为单位传输，前端展示时再除以 100
const amountInCents = Math.round(amount * 100)

// ✅ 记录踩坑 workaround，防止后人"优化"掉它
// iOS Safari 14 下 IntersectionObserver 在 iframe 内失效，改用 scroll 事件监听
window.addEventListener('scroll', handleScroll, { passive: true })

// ✅ 解释看起来奇怪但有意为之的写法
// 故意不 await，让日志上报在后台异步执行，不阻塞主流程
void reportEvent('page_view', { path })
```

---

## 五、错误处理：不要吞掉错误

### 不要用空 catch

```ts
// ❌ 错误被吞掉，出了问题完全不知道
try {
  await saveToDatabase(data)
} catch (e) {}

// ❌ 只打日志不处理，调用方拿到的是 undefined，后续逻辑崩溃
try {
  await saveToDatabase(data)
} catch (e) {
  console.error(e)
}

// ✅ 明确决策：能恢复就恢复，不能恢复就往上抛
try {
  await saveToDatabase(data)
} catch (e) {
  // 降级：写本地缓存，后续重试
  localCache.set(data)
  throw new DatabaseError('数据保存失败，已写入本地缓存', { cause: e })
}
```

### 区分"预期错误"和"意外错误"

```ts
// 预期错误：业务流程中正常会出现的情况，用自定义错误类型
class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} 不存在`)
    this.name = 'NotFoundError'
  }
}

// 调用层按类型分别处理
try {
  await updateUser(userId, payload)
} catch (e) {
  if (e instanceof ValidationError) {
    showFieldError(e.field, e.message)  // 展示给用户
  } else if (e instanceof NotFoundError) {
    redirect('/404')
  } else {
    // 意外错误：上报监控，展示通用错误提示
    monitor.captureException(e)
    showToast('操作失败，请稍后重试')
  }
}
```

### async/await 的错误处理

```ts
// ❌ 忘记 try/catch，Promise rejection 变成 unhandledRejection
async function loadPage() {
  const data = await fetchPageData()  // 如果失败，整个函数崩
  render(data)
}

// ✅ 方案一：try/catch 包裹整个异步流程
async function loadPage() {
  try {
    const data = await fetchPageData()
    render(data)
  } catch (e) {
    showErrorState()
  }
}

// ✅ 方案二：封装 safeAsync 工具，消除 try/catch 噪音
async function safeAsync<T>(promise: Promise<T>): Promise<[T, null] | [null, Error]> {
  try {
    const data = await promise
    return [data, null]
  } catch (e) {
    return [null, e instanceof Error ? e : new Error(String(e))]
  }
}

// 调用时
const [data, error] = await safeAsync(fetchPageData())
if (error) {
  showErrorState()
  return
}
render(data)
```

---

## 六、编码技巧：让结构更优雅

### 对象映射替代条件分支

多个 `if/else` 或 `switch` 本质上是一张"输入 → 输出"的映射表，直接用对象字面量来表达更清晰，也更容易扩展。

```ts
// ❌ 每加一种状态就要改函数体，逻辑分散
function getStatusLabel(status: string) {
  if (status === 'pending') return '待处理'
  if (status === 'processing') return '处理中'
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  return '未知'
}

// ✅ 映射表集中管理，新增状态只改一处
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  success: '成功',
  failed: '失败',
}

function getStatusLabel(status: string) {
  return STATUS_LABEL[status] ?? '未知'
}
```

映射表不只能存字符串，也可以存函数——用来替代"根据类型执行不同逻辑"的 `switch`：

```ts
// ❌ switch 越来越长，每个 case 里都是业务逻辑
function handleAction(type: string, payload: unknown) {
  switch (type) {
    case 'CREATE':
      createItem(payload)
      break
    case 'UPDATE':
      updateItem(payload)
      break
    case 'DELETE':
      deleteItem(payload)
      break
    default:
      console.warn('未知操作类型')
  }
}

// ✅ 策略表：类型 → 处理函数，逻辑完全解耦
type ActionHandler = (payload: unknown) => void

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  CREATE: createItem,
  UPDATE: updateItem,
  DELETE: deleteItem,
}

function handleAction(type: string, payload: unknown) {
  const handler = ACTION_HANDLERS[type]
  if (!handler) {
    console.warn(`未知操作类型: ${type}`)
    return
  }
  handler(payload)
}
```

这种模式叫**策略模式**，新增类型时只需要往对象里加一条，核心函数永远不用动（开闭原则）。

---

### 批量注册：让重复性代码消失

前端项目里经常需要批量注册组件、指令、路由——手动一条一条 import 是最常见的重复代码，用 `import.meta.glob` 可以完全自动化。

**批量注册 Vue 全局组件：**

```ts
// ❌ 每新增一个组件都要改这个文件
import BaseButton from './BaseButton.vue'
import BaseInput from './BaseInput.vue'
import BaseModal from './BaseModal.vue'
import BaseTable from './BaseTable.vue'

export default {
  install(app: App) {
    app.component('BaseButton', BaseButton)
    app.component('BaseInput', BaseInput)
    app.component('BaseModal', BaseModal)
    app.component('BaseTable', BaseTable)
  },
}

// ✅ 自动扫描 components/ 目录，零维护成本
// src/plugins/components.ts
import type { App } from 'vue'

export default {
  install(app: App) {
    // 匹配所有 Base 开头的组件
    const modules = import.meta.glob('../components/Base*.vue', { eager: true })

    for (const [path, module] of Object.entries(modules)) {
      const component = (module as any).default
      // 从路径提取组件名：../components/BaseButton.vue → BaseButton
      const name = path.match(/\/(\w+)\.vue$/)?.[1]
      if (name) app.component(name, component)
    }
  },
}
```

**批量注册 Vue 指令：**

```ts
// ❌ 手动逐一注册
import vLoading from './loading'
import vPermission from './permission'
import vDebounce from './debounce'

export function setupDirectives(app: App) {
  app.directive('loading', vLoading)
  app.directive('permission', vPermission)
  app.directive('debounce', vDebounce)
}

// ✅ 约定目录结构，自动注册
// src/directives/index.ts
// 目录结构：directives/loading.ts、directives/permission.ts ...
// 每个文件 export default 一个 Directive 对象，文件名即指令名

export function setupDirectives(app: App) {
  const modules = import.meta.glob('./*.ts', { eager: true })

  for (const [path, module] of Object.entries(modules)) {
    const name = path.match(/\/(\w+)\.ts$/)?.[1]
    if (name && name !== 'index') {
      app.directive(name, (module as any).default)
    }
  }
}
```

**批量注册路由（按模块自动合并）：**

```ts
// ❌ 每个业务模块的路由都要手动 import 进来
import userRoutes from './modules/user'
import orderRoutes from './modules/order'
import productRoutes from './modules/product'

const routes = [...userRoutes, ...orderRoutes, ...productRoutes]

// ✅ 自动合并 modules/ 目录下所有路由文件
// src/router/index.ts
const modules = import.meta.glob('./modules/*.ts', { eager: true })

const routes: RouteRecordRaw[] = Object.values(modules).flatMap(
  (module) => (module as any).default ?? [],
)

const router = createRouter({
  history: createWebHistory(),
  routes,
})
```

---

### 数据处理：链式调用代替临时变量

对数组做多步处理时，链式调用比一堆临时变量更清晰——每一步的意图一目了然：

```ts
// ❌ 中间变量噪音多，逻辑被分散
const allUsers = await fetchUsers()
const activeUsers = allUsers.filter(u => u.isActive)
const sortedUsers = activeUsers.sort((a, b) => b.createdAt - a.createdAt)
const recentUsers = sortedUsers.slice(0, 10)
const userNames = recentUsers.map(u => u.name)

// ✅ 链式调用，每一步做什么写得清楚
const userNames = (await fetchUsers())
  .filter(u => u.isActive)
  .sort((a, b) => b.createdAt - a.createdAt)
  .slice(0, 10)
  .map(u => u.name)
```

复杂场景下，`reduce` 可以把多次遍历合并成一次：

```ts
// ❌ 三次遍历
const total = orders.reduce((sum, o) => sum + o.amount, 0)
const count = orders.filter(o => o.isPaid).length
const labels = orders.map(o => o.label)

// ✅ 一次遍历拿到所有需要的数据
const { total, paidCount, labels } = orders.reduce(
  (acc, order) => ({
    total: acc.total + order.amount,
    paidCount: acc.paidCount + (order.isPaid ? 1 : 0),
    labels: [...acc.labels, order.label],
  }),
  { total: 0, paidCount: 0, labels: [] as string[] },
)
```

---

### 函数组合：把小函数串成流水线

当多个纯函数需要顺序执行，用 `pipe` 把它们串起来，比手动嵌套调用更直观：

```ts
// ❌ 嵌套调用，从里往外读，反直觉
const result = formatCurrency(roundToTwo(applyDiscount(applyTax(price))))

// ✅ pipe：从上到下读，和数据流向一致
const pipe =
  <T>(...fns: Array<(arg: T) => T>) =>
  (value: T) =>
    fns.reduce((acc, fn) => fn(acc), value)

const calculatePrice = pipe(applyTax, applyDiscount, roundToTwo, formatCurrency)
const result = calculatePrice(price)
```

`pipe` 的价值在于**每一步职责单一、可单独测试**，组合方式改了只需要调整 `pipe` 的参数顺序，不用动任何一个函数的实现。

---

### 对象解构：提取 + 重命名 + 默认值一步到位

```ts
// ❌ 多行赋值，重复写对象名
const name = config.name
const timeout = config.timeout || 5000
const method = config.method || 'GET'

// ✅ 解构时直接设默认值
const { name, timeout = 5000, method = 'GET' } = config
```

解构时重命名，避免命名冲突：

```ts
// 两个接口返回的数据都有 id 字段
const { id: userId, name: userName } = userResponse
const { id: orderId, amount } = orderResponse
```

函数参数解构，同时保留整个对象的引用：

```ts
// 需要对象本身（传给其他函数），也需要单独用 name、role
function renderUser({ name, role, ...rest }: User) {
  const label = `${name} (${role})`
  return { label, ...rest }
}
```

---

### 可选链 + 空值合并：消灭防御性判断

```ts
// ❌ 层层判断，主逻辑被淹没
function getCity(user: User | null) {
  if (user && user.address && user.address.city) {
    return user.address.city
  }
  return '未知城市'
}

// ✅ 两个运算符搞定
function getCity(user: User | null) {
  return user?.address?.city ?? '未知城市'
}
```

配合函数调用使用：

```ts
// ❌
if (callback && typeof callback === 'function') {
  callback(result)
}

// ✅
callback?.(result)
```

---

## 总结

这六个维度不是独立的，它们指向同一个目标：**降低读代码时的认知负担**。

| 维度 | 核心原则 |
|------|---------|
| 命名 | 说清楚是什么，不要猜 |
| 函数设计 | 一件事、参数用对象、副作用显式 |
| 代码结构 | 提前返回、条件命名、就近声明 |
| 注释 | 只写 why，不写 what |
| 错误处理 | 不吞错误，区分预期与意外 |
| 编码技巧 | 对象映射、批量注册、链式处理、函数组合 |

没有"完美"的代码，只有在当前上下文下"足够好"的代码。这些习惯的价值不在于规则本身，而在于形成一致的风格——团队里每个人都这样写，代码库才会真正可维护。
