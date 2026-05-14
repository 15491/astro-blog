---
title: "Vue3 组件封装实践"
description: "从封装原则到真实场景，系统梳理 Vue3 组件封装的核心模式：Props 设计、v-model、透传、插槽、配置式组件、withInstall 注册"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["Vue3", "组件封装", "Element Plus", "组件库"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Vue3 组件封装实践

组件封装的本质是**建立约束**：对外暴露最小必要接口，对内隐藏实现细节。封装得好，调用方根本不需要知道组件内部是怎么工作的。

本文从基础到进阶，梳理 Vue3 组件封装的核心模式。

## 封装的出发点

### 什么时候该封装

不是所有组件都值得封装。判断标准只有一个：**这段逻辑会在多个地方重复出现吗？**

```
重复出现 → 封装
只用一次 → 直接写，不要过早抽象
```

常见的封装场景：

- **UI 增强**：在 UI 库基础上添加业务定制（如给 `el-select` 加远程搜索）
- **逻辑复用**：多个页面共用相同的交互模式（如带确认弹窗的删除按钮）
- **配置简化**：把复杂的 props 组合封装成一个语义清晰的组件（如配置式表单）

### 好组件的三个标准

1. **单一职责**：一个组件只做一件事，副作用不要泄漏到外部
2. **接口稳定**：props / emits / slots 一旦对外暴露，不要随意修改
3. **内部透明**：调用方在必要时能通过 `ref` 或 `expose` 访问内部状态

---

## Props 设计

### 类型与默认值

Props 类型要尽量精确，默认值要符合最常见的使用场景：

```ts title="components/BaseButton/index.vue"
interface Props {
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  size?: 'large' | 'default' | 'small'
  loading?: boolean
  disabled?: boolean
  icon?: string
}

const props = withDefaults(defineProps<Props>(), {
  type: 'primary',
  size: 'default',
  loading: false,
  disabled: false,
})
```

:::tip[用 withDefaults 代替 default 对象]
Vue3 的 `withDefaults` 配合泛型 `defineProps<T>()` 使用，类型推导更准确，IDE 提示更友好，比选项式 API 的 `default: {}` 更安全。
:::

### 避免过度 Props

Props 太多是封装失败的信号。当一个组件需要超过 8 个 props 时，考虑：

- 用**插槽**替代部分展示类 props
- 将相关 props 合并为一个对象（如 `tableConfig`）
- 拆分组件职责

```ts
// ❌ props 爆炸
<UserCard
  :name="user.name"
  :avatar="user.avatar"
  :title="user.title"
  :department="user.department"
  :phone="user.phone"
  :email="user.email"
  :show-actions="true"
  :action-list="actions"
/>

// ✅ 语义合并
<UserCard :user="user" :actions="actions" />
```

---

## v-model 双向绑定

### 单个 v-model

Vue3 的 `v-model` 默认绑定 `modelValue` prop 和 `update:modelValue` emit：

```ts title="components/BaseInput/index.vue"
const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const handleInput = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
```

```html
<!-- 调用方 -->
<BaseInput v-model="keyword" />
<!-- 等价于 -->
<BaseInput :modelValue="keyword" @update:modelValue="keyword = $event" />
```

### 多个 v-model

Vue3 支持多个 `v-model`，通过自定义绑定名区分：

```ts title="components/DateRangePicker/index.vue"
const props = defineProps<{
  startDate: string
  endDate: string
}>()

const emit = defineEmits<{
  'update:startDate': [value: string]
  'update:endDate': [value: string]
}>()
```

```html
<!-- 调用方 -->
<DateRangePicker v-model:startDate="start" v-model:endDate="end" />
```

---

## Attrs 透传

### 默认透传行为

Vue3 默认将父组件传入的非 props 属性（class、style、事件）透传到根元素。封装 UI 库组件时，要主动利用这一机制，避免重复定义 props：

```ts title="components/AppInput/index.vue" {3}
// 关闭自动透传，手动控制透传目标
defineOptions({ inheritAttrs: false })

const attrs = useAttrs()
```

```html title="components/AppInput/index.vue"
<template>
  <!-- 将 attrs 透传给 el-input，而不是根 div -->
  <div class="app-input-wrapper">
    <el-input v-bind="attrs" />
  </div>
</template>
```

:::note[为什么要关闭 inheritAttrs]
默认透传会将属性加在最外层元素上。如果组件根元素是 `<div>` 而内部才是真正的 `<input>`，那 `placeholder`、`type` 等属性就会挂错位置。关闭后手动透传，精准控制落点。
:::

### 合并透传属性

透传时可以与组件内部 props 合并：

```html
<el-input
  v-bind="attrs"
  :class="['app-input', attrs.class]"
  clearable
/>
```

---

## 插槽设计

### 具名插槽提升灵活性

封装表格组件时，列的渲染逻辑千变万化，不可能全用 props 覆盖。插槽是正确答案：

```html title="components/ProTable/index.vue"
<el-table :data="tableData">
  <template v-for="col in columns" :key="col.prop">
    <!-- 有自定义插槽则用插槽，否则用默认渲染 -->
    <el-table-column v-bind="col">
      <template v-if="$slots[col.prop]" #default="scope">
        <slot :name="col.prop" v-bind="scope" />
      </template>
    </el-table-column>
  </template>
</el-table>
```

调用方按需覆盖任意列：

```html
<ProTable :columns="columns" :data="list">
  <!-- 只有状态列需要自定义 -->
  <template #status="{ row }">
    <el-tag :type="row.status === 1 ? 'success' : 'danger'">
      {{ row.status === 1 ? '启用' : '禁用' }}
    </el-tag>
  </template>
</ProTable>
```

### 作用域插槽向上暴露数据

```html title="components/LoadMore/index.vue"
<template>
  <div>
    <slot :list="list" :loading="loading" :loadMore="loadMore" />
  </div>
</template>
```

```html
<!-- 调用方拿到 list 和 loadMore，自由渲染 -->
<LoadMore v-slot="{ list, loading, loadMore }">
  <ul>
    <li v-for="item in list" :key="item.id">{{ item.name }}</li>
  </ul>
  <button :disabled="loading" @click="loadMore">加载更多</button>
</LoadMore>
```

---

## expose 控制对外接口

子组件的内部方法默认不对外暴露（与 Vue2 不同）。需要主动通过 `defineExpose` 声明：

```ts title="components/BaseForm/index.vue"
const formRef = ref()

const validate = () => formRef.value?.validate()
const resetFields = () => formRef.value?.resetFields()
const setValues = (values: Record<string, unknown>) => {
  Object.assign(formData, values)
}

defineExpose({ validate, resetFields, setValues })
```

调用方通过 `ref` 调用：

```html
<BaseForm ref="formRef" />
```

```ts
const formRef = ref()
// 提交前校验
await formRef.value.validate()
```

:::warning[不要过度 expose]
`defineExpose` 暴露的内容等同于对外接口，一旦暴露就有被依赖的风险。只暴露真正需要从外部调用的方法，内部实现细节不要暴露。
:::

---

## 配置式组件

当相同结构的组件需要大量重复使用时（如表单、表格），用 JSON 配置驱动渲染是更好的方案。

### 配置式表单

核心思路：将字段定义从模板中剥离，改为 JS 对象描述：

```ts
// 字段配置
interface FormField {
  prop: string
  label: string
  type: 'input' | 'select' | 'date' | 'switch'
  options?: { label: string; value: unknown }[]
  rules?: FormItemRule[]
  placeholder?: string
}
```

```ts title="views/UserEdit.vue"
const fields: FormField[] = [
  { prop: 'name', label: '姓名', type: 'input', rules: [{ required: true }] },
  { prop: 'dept', label: '部门', type: 'select', options: deptOptions },
  { prop: 'joinDate', label: '入职日期', type: 'date' },
  { prop: 'active', label: '启用状态', type: 'switch' },
]
```

```html title="components/ProForm/index.vue"
<el-form :model="formData" ref="formRef">
  <el-form-item
    v-for="field in fields"
    :key="field.prop"
    :label="field.label"
    :prop="field.prop"
    :rules="field.rules"
  >
    <!-- 根据 type 动态渲染不同控件 -->
    <el-input v-if="field.type === 'input'" v-model="formData[field.prop]" />
    <el-select v-else-if="field.type === 'select'" v-model="formData[field.prop]">
      <el-option
        v-for="opt in field.options"
        :key="String(opt.value)"
        :label="opt.label"
        :value="opt.value"
      />
    </el-select>
    <el-date-picker v-else-if="field.type === 'date'" v-model="formData[field.prop]" />
    <el-switch v-else-if="field.type === 'switch'" v-model="formData[field.prop]" />
  </el-form-item>
</el-form>
```

**优点**：新增一个字段只需在配置数组里加一行，不需要改模板；字段顺序调整只需调整数组顺序。

:::tip[异步 options]
选项数据通常来自接口。可以在 `FormField` 上支持 `optionsApi` 字段，组件内部自动发起请求并缓存结果，让调用方无感知。
:::

---

## withInstall — 组件插件化

Element Plus 的每个组件都可以单独作为 Vue 插件使用。封装自己的组件库时可以复用这一模式：

```ts title="utils/withInstall.ts"
import type { App, Component } from 'vue'

export const withInstall = <T extends Component>(component: T) => {
  const installable = component as T & { install: (app: App) => void }
  installable.install = (app: App) => {
    app.component(installable.name!, installable)
  }
  return installable
}
```

```ts title="components/ProTable/index.ts"
import ProTable from './index.vue'
import { withInstall } from '@/utils/withInstall'

export const YcProTable = withInstall(ProTable)
export default YcProTable
```

```ts title="index.ts（组件库入口）"
import { YcProTable } from './components/ProTable'
import { YcProForm } from './components/ProForm'
import type { App } from 'vue'

const components = [YcProTable, YcProForm]

// 全量注册
export const install = (app: App) => {
  components.forEach(c => app.use(c))
}

// 按需导出
export { YcProTable, YcProForm }
```

调用方可以全量注册，也可以按需引入：

```ts title="main.ts（全量）"
import { install } from '@yc/components'
app.use(install)
```

```ts title="某个页面（按需）"
import { YcProTable } from '@yc/components'
```

---

## 组件库目录结构

```
packages/
└── components/
    ├── src/
    │   ├── pro-table/
    │   │   ├── index.vue        # 组件实现
    │   │   ├── index.ts         # withInstall 包装 + 导出
    │   │   └── types.ts         # Props 类型定义
    │   ├── pro-form/
    │   │   ├── index.vue
    │   │   ├── index.ts
    │   │   └── types.ts
    │   └── index.ts             # 汇总导出所有组件
    └── package.json
```

每个组件自成一个目录，类型定义独立文件，`index.ts` 负责 `withInstall` 包装。这样每个组件都能单独被按需引入，也不会因为类型文件引入了不必要的运行时代码。

---

## 小结

| 模式 | 适用场景 |
|------|----------|
| `withDefaults` + 泛型 Props | 所有组件的基础 |
| 多个 v-model | 双向绑定多个独立值（如日期范围） |
| `inheritAttrs: false` + `v-bind="attrs"` | 封装 UI 库组件，透传能力透传到正确位置 |
| 具名 + 作用域插槽 | 允许调用方自定义局部渲染（如表格列） |
| `defineExpose` | 对外暴露必要的命令式接口 |
| JSON Schema 配置驱动 | 结构固定但内容多变的场景（表单、表格） |
| `withInstall` | 构建可作为 Vue 插件使用的组件库 |

封装不是目的，**减少重复、降低出错概率、让调用更直觉**才是。过早封装比不封装更危险——等到真正出现第二次重复的时候再动手，通常是更好的选择。
