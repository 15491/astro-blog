---
title: "React 组件封装实践"
description: "系统梳理 React 组件封装的核心模式：Props 设计、forwardRef、受控与非受控、复合组件、自定义 Hook、配置式组件"
publishDate: "2026-05-15T00:00:00.000Z"
updatedDate: ""
tags: ["React", "组件封装", "TypeScript", "Hook", "设计模式"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# React 组件封装实践

React 组件封装和 Vue 的核心差异在于**逻辑的归属方式**：Vue 用选项/组合式 API 把状态、模板、逻辑放在同一个文件里，React 则更倾向于把逻辑抽成自定义 Hook，组件只负责渲染。

这个差异直接影响封装思路：React 的组件封装和 Hook 封装几乎总是同时进行的。

## Props 设计

### 类型定义

React 用 TypeScript interface 描述 props，约定放在组件文件顶部：

```tsx title="components/Button/index.tsx"
interface ButtonProps {
  // 外观
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  // 状态
  loading?: boolean
  disabled?: boolean
  // 内容
  children: React.ReactNode
  icon?: React.ReactNode
  // 事件
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  icon,
  onClick,
}) => {
  return (
    <button
      className={`btn btn-${variant} btn-${size}`}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}
```

### 事件命名约定

React 的事件 props 统一用 `onXxx` 命名，且类型要精确到 React 的合成事件：

```ts
interface Props {
  onChange?: (value: string) => void        // 值变化
  onSearch?: (keyword: string) => void      // 搜索触发
  onVisibleChange?: (visible: boolean) => void  // 显隐变化
}
```

### 用 children 替代展示类 Props

能用 `children` 解决的，不要定义 props：

```tsx
// ❌ 用 props 传标题和内容，调用方写起来很局促
<Card title="用户信息" footer={<Button>保存</Button>}>
  <p>内容</p>
</Card>

// ✅ 用具名 children（render props 变体）
<Card>
  <Card.Header>用户信息</Card.Header>
  <Card.Body><p>内容</p></Card.Body>
  <Card.Footer><Button>保存</Button></Card.Footer>
</Card>
```

后者就是**复合组件模式**，后面单独一节展开。

---

## forwardRef 与 useImperativeHandle

React 组件默认不暴露内部的 DOM 节点或方法。需要父组件拿到子组件的 `ref` 时，必须用 `forwardRef` 包裹。

### 转发 DOM ref

最常见的场景：封装 input，让父组件能调用 `.focus()`：

```tsx title="components/SearchInput/index.tsx"
interface SearchInputProps {
  placeholder?: string
  onSearch: (value: string) => void
}

// forwardRef 让父组件的 ref 透传到内部的 <input>
const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ placeholder, onSearch }, ref) => {
    const [value, setValue] = useState('')

    return (
      <div className="search-input">
        <input
          ref={ref}
          value={value}
          placeholder={placeholder}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch(value)}
        />
        <button onClick={() => onSearch(value)}>搜索</button>
      </div>
    )
  }
)

SearchInput.displayName = 'SearchInput'
```

父组件：

```tsx
const inputRef = useRef<HTMLInputElement>(null)

// 页面加载后自动聚焦
useEffect(() => {
  inputRef.current?.focus()
}, [])

<SearchInput ref={inputRef} onSearch={handleSearch} />
```

### useImperativeHandle 控制暴露面

直接转发 DOM ref 会把整个 DOM 节点暴露出去，父组件能做任何操作。用 `useImperativeHandle` 可以精确控制只暴露哪些方法：

```tsx title="components/BaseForm/index.tsx"
interface FormHandle {
  validate: () => Promise<boolean>
  reset: () => void
  setValues: (values: Record<string, unknown>) => void
}

interface FormProps {
  initialValues?: Record<string, unknown>
  onSubmit: (values: Record<string, unknown>) => void
}

const BaseForm = React.forwardRef<FormHandle, FormProps>(
  ({ initialValues = {}, onSubmit }, ref) => {
    const [values, setValues] = useState(initialValues)
    const [errors, setErrors] = useState<Record<string, string>>({})

    // 只暴露三个方法，DOM 节点完全隐藏
    useImperativeHandle(ref, () => ({
      validate: async () => {
        // ... 校验逻辑
        return Object.keys(errors).length === 0
      },
      reset: () => {
        setValues(initialValues)
        setErrors({})
      },
      setValues: (newValues) => {
        setValues(prev => ({ ...prev, ...newValues }))
      },
    }))

    return <form onSubmit={e => { e.preventDefault(); onSubmit(values) }}>...</form>
  }
)
```

父组件命令式调用：

```tsx
const formRef = useRef<FormHandle>(null)

const handleSave = async () => {
  const valid = await formRef.current?.validate()
  if (!valid) return
  // 提交
}

<BaseForm ref={formRef} onSubmit={handleSubmit} />
```

:::tip[displayName 不要忘]
`forwardRef` 包裹后，React DevTools 里组件名会丢失变成 `ForwardRef`。加上 `ComponentName.displayName = 'ComponentName'` 可以恢复，方便调试。
:::

---

## 受控与非受控

这是 React 特有的一对概念，封装表单类组件时必须想清楚。

### 受控组件

状态由父组件持有，子组件通过 `value` + `onChange` 同步：

```tsx
// 受控：value 和 onChange 都由外部控制
<input value={name} onChange={e => setName(e.target.value)} />
```

封装受控组件：

```tsx
interface ControlledInputProps {
  value: string
  onChange: (value: string) => void
}

const ControlledInput: React.FC<ControlledInputProps> = ({ value, onChange }) => (
  <input value={value} onChange={e => onChange(e.target.value)} />
)
```

### 非受控组件

状态由组件自己维护，父组件只在需要时通过 `ref` 读取：

```tsx
interface UncontrolledInputProps {
  defaultValue?: string
}

const UncontrolledInput = React.forwardRef<HTMLInputElement, UncontrolledInputProps>(
  ({ defaultValue = '' }, ref) => (
    <input ref={ref} defaultValue={defaultValue} />
  )
)

// 父组件只在提交时读一次值，不需要实时同步
const inputRef = useRef<HTMLInputElement>(null)
const handleSubmit = () => console.log(inputRef.current?.value)
```

### 同时支持两种模式

生产组件库通常两种模式都支持。判断 `value` 是否由外部传入，有则受控，无则自管理：

```tsx
interface FlexibleInputProps {
  value?: string          // 传了就是受控
  defaultValue?: string   // 非受控时的初始值
  onChange?: (value: string) => void
}

const FlexibleInput: React.FC<FlexibleInputProps> = ({
  value: valueProp,
  defaultValue = '',
  onChange,
}) => {
  const isControlled = valueProp !== undefined
  const [innerValue, setInnerValue] = useState(defaultValue)

  const value = isControlled ? valueProp : innerValue

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isControlled) setInnerValue(e.target.value)
    onChange?.(e.target.value)
  }

  return <input value={value} onChange={handleChange} />
}
```

:::note[Ant Design 的 useMergedState]
Ant Design 内部封装了 `useMergedState` Hook 专门处理这个逻辑，避免每个组件都重复实现。如果项目里有大量表单组件，可以参考这个思路抽一个通用 Hook。
:::

---

## 复合组件模式

复合组件（Compound Components）用于解决父子组件之间隐式状态共享的问题，是封装结构复杂组件的最佳方案。

典型场景：`Select` + `Option`、`Tabs` + `Tab`、`Accordion` + `AccordionItem`。

### 用 Context 共享状态

```tsx title="components/Tabs/index.tsx"
interface TabsContextValue {
  activeKey: string
  onChange: (key: string) => void
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

const useTabs = () => {
  const ctx = React.useContext(TabsContext)
  if (!ctx) throw new Error('Tab 必须在 Tabs 内部使用')
  return ctx
}
```

父组件持有状态，通过 Context 下发：

```tsx
interface TabsProps {
  defaultActiveKey?: string
  children: React.ReactNode
}

const Tabs: React.FC<TabsProps> & {
  Tab: typeof Tab
  Panel: typeof Panel
} = ({ defaultActiveKey = '', children }) => {
  const [activeKey, setActiveKey] = useState(defaultActiveKey)

  return (
    <TabsContext.Provider value={{ activeKey, onChange: setActiveKey }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  )
}
```

子组件从 Context 读取状态：

```tsx
interface TabProps {
  tabKey: string
  label: string
}

const Tab: React.FC<TabProps> = ({ tabKey, label }) => {
  const { activeKey, onChange } = useTabs()
  return (
    <button
      className={activeKey === tabKey ? 'tab active' : 'tab'}
      onClick={() => onChange(tabKey)}
    >
      {label}
    </button>
  )
}

interface PanelProps {
  tabKey: string
  children: React.ReactNode
}

const Panel: React.FC<PanelProps> = ({ tabKey, children }) => {
  const { activeKey } = useTabs()
  return activeKey === tabKey ? <div className="panel">{children}</div> : null
}

// 挂载子组件，形成命名空间
Tabs.Tab = Tab
Tabs.Panel = Panel
```

调用方写起来语义清晰，不需要记忆任何隐式约定：

```tsx
<Tabs defaultActiveKey="profile">
  <Tabs.Tab tabKey="profile" label="基本信息" />
  <Tabs.Tab tabKey="security" label="安全设置" />

  <Tabs.Panel tabKey="profile"><ProfileForm /></Tabs.Panel>
  <Tabs.Panel tabKey="security"><SecurityForm /></Tabs.Panel>
</Tabs>
```

---

## 自定义 Hook 分离逻辑

React 封装的核心原则：**组件只管渲染，逻辑放到 Hook 里**。

### 封装数据请求

```ts title="hooks/useRequest.ts"
interface UseRequestOptions<T> {
  immediate?: boolean          // 是否立即执行，默认 true
  initialData?: T
  onSuccess?: (data: T) => void
  onError?: (error: Error) => void
}

function useRequest<T>(
  fetcher: () => Promise<T>,
  options: UseRequestOptions<T> = {}
) {
  const { immediate = true, initialData, onSuccess, onError } = options

  const [data, setData] = useState<T | undefined>(initialData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      setData(result)
      onSuccess?.(result)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setError(err)
      onError?.(err)
    } finally {
      setLoading(false)
    }
  }, [fetcher])

  useEffect(() => {
    if (immediate) run()
  }, [immediate, run])

  return { data, loading, error, run }
}
```

组件里只剩渲染逻辑：

```tsx
const UserList: React.FC = () => {
  const { data, loading, error, run } = useRequest(
    () => userApi.getList({ page: 1 }),
    { onError: () => toast.error('加载失败') }
  )

  if (loading) return <Skeleton />
  if (error) return <ErrorState onRetry={run} />

  return <Table data={data?.list ?? []} />
}
```

### 封装表单逻辑

```ts title="hooks/useForm.ts"
type Rules<T> = Partial<Record<keyof T, (value: unknown) => string | undefined>>

function useForm<T extends Record<string, unknown>>(initialValues: T) {
  const [values, setValues] = useState<T>(initialValues)
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({})

  const setValue = <K extends keyof T>(key: K, value: T[K]) => {
    setValues(prev => ({ ...prev, [key]: value }))
    // 修改后清除该字段错误
    setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  const validate = (rules: Rules<T>): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {}
    for (const key in rules) {
      const error = rules[key]?.(values[key])
      if (error) newErrors[key] = error
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const reset = () => {
    setValues(initialValues)
    setErrors({})
  }

  return { values, errors, setValue, validate, reset }
}
```

```tsx
const LoginForm: React.FC = () => {
  const { values, errors, setValue, validate } = useForm({
    username: '',
    password: '',
  })

  const handleSubmit = () => {
    const valid = validate({
      username: v => !v ? '用户名不能为空' : undefined,
      password: v => (v as string).length < 6 ? '密码至少 6 位' : undefined,
    })
    if (valid) login(values)
  }

  return (
    <form>
      <Input
        value={values.username}
        onChange={v => setValue('username', v)}
        error={errors.username}
      />
      <Input
        type="password"
        value={values.password}
        onChange={v => setValue('password', v)}
        error={errors.password}
      />
      <Button onClick={handleSubmit}>登录</Button>
    </form>
  )
}
```

---

## 配置式组件

和 Vue 的 ProForm 一样，React 也可以用 JSON Schema 驱动表单渲染，减少重复模板：

```ts title="components/ProForm/types.ts"
interface FormField<T = Record<string, unknown>> {
  name: keyof T
  label: string
  type: 'input' | 'select' | 'date' | 'switch' | 'textarea'
  options?: { label: string; value: unknown }[]
  rules?: Array<(value: unknown) => string | undefined>
  placeholder?: string
  span?: number  // 栅格占比，默认 24
}
```

```tsx title="components/ProForm/index.tsx"
interface ProFormProps<T extends Record<string, unknown>> {
  fields: FormField<T>[]
  initialValues?: Partial<T>
  onSubmit: (values: T) => void
}

function ProForm<T extends Record<string, unknown>>({
  fields,
  initialValues = {} as T,
  onSubmit,
}: ProFormProps<T>) {
  const { values, errors, setValue, validate } = useForm(initialValues as T)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const rules = Object.fromEntries(
      fields
        .filter(f => f.rules?.length)
        .map(f => [f.name, (v: unknown) => {
          for (const rule of f.rules!) {
            const err = rule(v)
            if (err) return err
          }
        }])
    ) as Rules<T>
    if (validate(rules)) onSubmit(values)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        {fields.map(field => (
          <div key={String(field.name)} className={`col-${field.span ?? 24}`}>
            <label>{field.label}</label>

            {field.type === 'input' && (
              <input
                value={String(values[field.name] ?? '')}
                placeholder={field.placeholder}
                onChange={e => setValue(field.name, e.target.value as T[keyof T])}
              />
            )}
            {field.type === 'select' && (
              <select
                value={String(values[field.name] ?? '')}
                onChange={e => setValue(field.name, e.target.value as T[keyof T])}
              >
                {field.options?.map(opt => (
                  <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}
            {field.type === 'switch' && (
              <input
                type="checkbox"
                checked={Boolean(values[field.name])}
                onChange={e => setValue(field.name, e.target.checked as T[keyof T])}
              />
            )}

            {errors[field.name] && (
              <span className="error">{errors[field.name]}</span>
            )}
          </div>
        ))}
      </div>
      <button type="submit">提交</button>
    </form>
  )
}
```

调用方只需要定义字段配置：

```tsx
interface UserForm {
  name: string
  dept: string
  active: boolean
}

const fields: FormField<UserForm>[] = [
  {
    name: 'name',
    label: '姓名',
    type: 'input',
    rules: [v => !v ? '姓名不能为空' : undefined],
  },
  {
    name: 'dept',
    label: '部门',
    type: 'select',
    options: [
      { label: '技术部', value: 'tech' },
      { label: '产品部', value: 'product' },
    ],
  },
  { name: 'active', label: '启用状态', type: 'switch' },
]

<ProForm<UserForm> fields={fields} onSubmit={handleSave} />
```

---

## 与 Vue 封装的核心差异

| | Vue 3 | React |
|--|-------|-------|
| 暴露内部方法 | `defineExpose` | `forwardRef` + `useImperativeHandle` |
| 逻辑复用 | Composable（`useXxx` 函数） | 自定义 Hook（`useXxx` 函数） |
| 跨层传数据 | `provide` / `inject` | `Context` + `useContext` |
| 双向绑定 | `v-model`（语法糖） | 受控组件（`value` + `onChange`） |
| 插槽 | `<slot>` / 具名插槽 | `children` / render props / 复合组件 |
| 组件注册 | `withInstall` + `app.use` | 直接 export，无需注册 |

两者的逻辑复用方式几乎一样（都是 `useXxx` Hook），最大的差异在于**插槽**：Vue 的具名插槽在 React 里要用复合组件或 render props 来替代，写法更显式但也更灵活。

---

## 小结

| 模式 | 适用场景 |
|------|----------|
| `forwardRef` + `useImperativeHandle` | 暴露命令式接口（validate、focus、reset） |
| 受控 + 非受控兼容 | 表单类组件，调用方可自由选择控制权 |
| 复合组件（Context） | 父子强关联、结构复杂的组件（Tabs、Select） |
| 自定义 Hook | 把请求、表单、滚动等逻辑从组件里剥离 |
| 配置式（JSON Schema） | 结构固定但字段多变的表单、表格场景 |

React 组件封装没有"银弹"模式，关键是**分清状态的归属**：哪些状态属于组件内部，哪些需要对外同步，哪些通过 Context 跨层共享。想清楚这一点，选哪种模式就自然清晰了。
