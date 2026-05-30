---
title: "TypeScript 高级类型实战"
description: "从条件类型、infer 推导到映射类型、模板字面量类型，逐一拆解 TypeScript 类型系统的高级特性，配合手写常用工具类型加深理解，最后落地到项目中的真实使用场景"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["TypeScript", "类型系统", "工程实践"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# TypeScript 高级类型实战

TypeScript 的入门门槛不高——给变量加上 `: string`，给函数写好参数和返回值类型，基本就够用了。但当项目规模变大，写出**能随代码结构自动推导、无需手动维护**的类型，才是 TS 真正的价值所在。

本文从条件类型出发，逐层拆解高级类型的核心机制，最后落地到项目中的实际模式。

---

## 条件类型

条件类型的语法和三元表达式一样：

```ts
type IsString<T> = T extends string ? true : false

type A = IsString<'hello'>  // true
type B = IsString<42>       // false
```

`T extends string` 不是运行时判断，而是**类型层面的问题**：「T 能不能赋值给 string 类型？」

### 分布式条件类型

当 `T` 是联合类型时，条件类型会对每个成员**分别求值**再合并：

```ts
type ToArray<T> = T extends unknown ? T[] : never

type A = ToArray<string | number>
// 等价于：ToArray<string> | ToArray<number>
// 结果：string[] | number[]
```

这个分布行为是条件类型最容易踩坑的地方。如果不想分布，用元组包裹：

```ts
type ToArrayNoDistribute<T> = [T] extends [unknown] ? T[] : never

type B = ToArrayNoDistribute<string | number>
// 结果：(string | number)[]，不分布
```

### 用条件类型过滤联合类型

`never` 在联合类型中会被自动消除，利用这点可以过滤：

```ts
// 从联合类型中过滤掉 null 和 undefined
type NonNullable<T> = T extends null | undefined ? never : T

type C = NonNullable<string | null | undefined | number>
// string | number
```

---

## infer：在条件类型中推断类型

`infer` 只能出现在条件类型的 `extends` 子句里，用于**捕获某个位置的类型**：

```ts
// 提取函数返回值类型
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never

type Fn = () => { name: string; age: number }
type R = ReturnType<Fn>  // { name: string; age: number }
```

```ts
// 提取函数第一个参数类型
type FirstArg<T> = T extends (first: infer F, ...rest: any[]) => any ? F : never

type F = FirstArg<(a: number, b: string) => void>  // number
```

```ts
// 提取 Promise 的值类型
type Awaited<T> = T extends Promise<infer V> ? Awaited<V> : T

type V = Awaited<Promise<Promise<string>>>  // string
```

`infer` 的本质是：在模式匹配时，把某个「坑位」的实际类型捕获出来，赋给一个临时类型变量。

### 从数组类型中提取元素类型

```ts
type ElementType<T> = T extends (infer E)[] ? E : never

type E1 = ElementType<string[]>          // string
type E2 = ElementType<Array<number>>     // number
type E3 = ElementType<[boolean, string]> // boolean | string
```

### 提取对象方法的返回值

```ts
type MethodReturn<T, K extends keyof T> =
  T[K] extends (...args: any[]) => infer R ? R : never

interface Api {
  getUser(): { id: number; name: string }
  deleteUser(id: number): boolean
}

type A = MethodReturn<Api, 'getUser'>    // { id: number; name: string }
type B = MethodReturn<Api, 'deleteUser'> // boolean
```

---

## 映射类型

映射类型用于**批量转换对象类型**，语法是 `[K in keyof T]`：

```ts
// 把所有属性改为只读
type Readonly<T> = {
  readonly [K in keyof T]: T[K]
}

// 把所有属性改为可选
type Partial<T> = {
  [K in keyof T]?: T[K]
}

// 把所有属性改为必填
type Required<T> = {
  [K in keyof T]-?: T[K]  // -? 表示去掉可选标记
}
```

`-?` 是**修饰符操作符**，`-readonly` 同理可以去掉只读。

### 映射时改变属性类型

```ts
// 把所有属性类型改为 string
type Stringify<T> = {
  [K in keyof T]: string
}

// 把所有属性包装成 Promise
type Promisify<T> = {
  [K in keyof T]: Promise<T[K]>
}
```

### 用 as 重映射键名

TS 4.1 起，可以在映射类型中用 `as` 重命名键：

```ts
// 给所有键加 get 前缀，并首字母大写
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

interface User {
  name: string
  age: number
}

type UserGetters = Getters<User>
// {
//   getName: () => string
//   getAge: () => number
// }
```

用 `as never` 可以在映射过程中过滤掉某些键：

```ts
// 只保留函数类型的属性
type FunctionProps<T> = {
  [K in keyof T as T[K] extends Function ? K : never]: T[K]
}

interface Mixed {
  name: string
  onClick: () => void
  count: number
  onChange: (v: string) => void
}

type FnOnly = FunctionProps<Mixed>
// { onClick: () => void; onChange: (v: string) => void }
```

---

## 模板字面量类型

TS 4.1 引入，允许在类型层面拼接字符串：

```ts
type EventName<T extends string> = `on${Capitalize<T>}`

type A = EventName<'click'>   // 'onClick'
type B = EventName<'change'>  // 'onChange'
```

与联合类型结合时会自动展开：

```ts
type Direction = 'top' | 'right' | 'bottom' | 'left'
type MarginKey = `margin-${Direction}`
// 'margin-top' | 'margin-right' | 'margin-bottom' | 'margin-left'
```

### 实战：类型安全的事件系统

```ts
type EventMap = {
  click: { x: number; y: number }
  input: { value: string }
  resize: { width: number; height: number }
}

type EventHandler<T extends keyof EventMap> = (event: EventMap[T]) => void

type HandlerMap = {
  [K in keyof EventMap as `on${Capitalize<string & K>}`]: EventHandler<K>
}
// {
//   onClick: (event: { x: number; y: number }) => void
//   onInput: (event: { value: string }) => void
//   onResize: (event: { width: number; height: number }) => void
// }
```

### 从字符串类型中提取片段

配合 infer 可以做字符串层面的模式匹配：

```ts
// 提取路由参数名：'/users/:id/posts/:postId' → 'id' | 'postId'
type ExtractParams<S extends string> =
  S extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractParams<`/${Rest}`>
    : S extends `${string}:${infer Param}`
      ? Param
      : never

type Params = ExtractParams<'/users/:id/posts/:postId'>
// 'id' | 'postId'
```

---

## 手写常用工具类型

理解内置工具类型的实现，有助于组合出项目特有的工具类型。

### Pick 和 Omit

```ts
// 只保留指定的键
type Pick<T, K extends keyof T> = {
  [P in K]: T[P]
}

// 去掉指定的键
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>

// 依赖：Exclude 从联合类型中去掉某些成员
type Exclude<T, U> = T extends U ? never : T
```

### Record

```ts
// 构造一个键为 K、值为 V 的对象类型
type Record<K extends keyof any, V> = {
  [P in K]: V
}

type PageMap = Record<'home' | 'about' | 'contact', { title: string }>
```

### Parameters 和 ReturnType

```ts
type Parameters<T extends (...args: any) => any> =
  T extends (...args: infer P) => any ? P : never

type ReturnType<T extends (...args: any) => any> =
  T extends (...args: any) => infer R ? R : any
```

### DeepPartial：深度可选

内置的 `Partial` 只处理第一层，深层嵌套对象需要递归：

```ts
type DeepPartial<T> =
  T extends Map<infer K, infer V>     ? Map<K, DeepPartial<V>>
  : T extends Set<infer E>            ? Set<DeepPartial<E>>
  : T extends (infer E)[]             ? DeepPartial<E>[]
  : T extends ReadonlyArray<infer E>  ? ReadonlyArray<DeepPartial<E>>
  : T extends object                  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T
```

各分支的处理顺序很重要——`Map`、`Set`、数组都继承自 `object`，必须在 `object` 分支之前匹配，否则会被当成普通对象递归展开键名（`Map` 会变成 `{ get?: ...; set?: ...; has?: ... }`）。

```ts
interface Config {
  server: {
    host: string
    port: number
    tls: {
      cert: string
      key: string
    }
  }
  tags: string[]
  meta: Map<string, { value: number }>
  debug: boolean
}

type PartialConfig = DeepPartial<Config>
// server.host、server.tls.cert 全部变为可选
// tags 变为 (string | undefined)[]（数组元素也可选）
// meta 变为 Map<string, { value?: number }>
```

### DeepReadonly

```ts
type DeepReadonly<T> = T extends (infer E)[]
  ? ReadonlyArray<DeepReadonly<E>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T
```

---

## 项目中的真实模式

### API 响应类型自动推导

统一封装 API 请求后，用类型推导代替手写每个接口的返回类型：

```ts title="types/api.ts"
// 标准后端响应结构
interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

// 提取 data 的类型
type ApiData<T> = T extends ApiResponse<infer D> ? D : never

// 请求函数泛型
async function request<T>(url: string): Promise<ApiResponse<T>> {
  const res = await fetch(url)
  return res.json()
}
```

```ts title="api/user.ts"
interface User {
  id: number
  name: string
  email: string
}

// 调用时只需声明业务数据类型
const getUser = (id: number) => request<User>(`/api/users/${id}`)

// 返回值类型自动推导为 Promise<ApiResponse<User>>
const res = await getUser(1)
res.data.name // ✅ 有类型提示
```

### 表单字段类型安全

```ts title="types/form.ts"
// 从业务对象类型生成表单字段配置类型
type FormField<T> = {
  [K in keyof T]: {
    key: K
    label: string
    type: T[K] extends number ? 'number' : T[K] extends boolean ? 'switch' : 'text'
    required?: boolean
  }
}[keyof T]

interface ProductForm {
  name: string
  price: number
  active: boolean
}

type ProductField = FormField<ProductForm>
// {
//   key: 'name'; label: string; type: 'text'; required?: boolean
// } | {
//   key: 'price'; label: string; type: 'number'; required?: boolean
// } | {
//   key: 'active'; label: string; type: 'switch'; required?: boolean
// }
```

### Vuex / Pinia Store 类型

```ts title="stores/user.ts"
import { defineStore } from 'pinia'

const useUserStore = defineStore('user', {
  state: () => ({
    list: [] as User[],
    current: null as User | null,
  }),
  getters: {
    count: (state) => state.list.length,
  },
  actions: {
    async fetchList() {
      this.list = await request<User[]>('/api/users').then(r => r.data)
    },
  },
})

// 提取 Store 的 state 类型（不写 ReturnType 就要手写一遍）
type UserState = ReturnType<typeof useUserStore>['$state']
```

### 严格的组件 Props

```ts title="components/Table.vue"
<script setup lang="ts">
interface Column<T> {
  key: keyof T             // 只允许传对象上存在的字段名
  title: string
  render?: (val: T[keyof T], row: T) => string
}

interface Props<T extends Record<string, unknown>> {
  data: T[]
  columns: Column<T>[]
}

// 泛型组件（Vue 3.3+）
const props = defineProps<Props<Record<string, unknown>>>()
</script>
```

---

## 类型工具参考速查

| 工具类型 | 作用 | 核心实现思路 |
|---------|------|------------|
| `Partial<T>` | 所有属性可选 | 映射类型 + `?` |
| `Required<T>` | 所有属性必填 | 映射类型 + `-?` |
| `Readonly<T>` | 所有属性只读 | 映射类型 + `readonly` |
| `Pick<T, K>` | 只保留指定键 | `[P in K]` 映射 |
| `Omit<T, K>` | 去掉指定键 | `Pick` + `Exclude` |
| `Record<K, V>` | 构造键值对类型 | `[P in K]: V` |
| `Exclude<T, U>` | 联合类型排除 | 分布式条件类型 |
| `Extract<T, U>` | 联合类型取交 | 分布式条件类型 |
| `NonNullable<T>` | 去掉 null/undefined | `Exclude<T, null \| undefined>` |
| `Parameters<T>` | 函数参数类型元组 | `infer P` |
| `ReturnType<T>` | 函数返回值类型 | `infer R` |
| `Awaited<T>` | Promise 解包 | 递归 `infer V` |

:::tip[类型体操的边界]
高级类型最大的风险是**过度设计**。追求完美的类型推导，可能写出让同事读不懂、报错信息无法理解的类型。实际项目中优先选「够用且可读」的方案，工具类型手写主要用于理解原理。
:::
