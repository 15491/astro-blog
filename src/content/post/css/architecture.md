---
title: "CSS 架构与设计系统"
description: "从 BEM 命名、CSS Modules 到原子化 CSS，系统梳理前端样式的架构方案选型、CSS 自定义属性 token 体系设计与响应式布局策略"
publishDate: "2026-05-31T00:00:00.000Z"
updatedDate: "2026-05-30T17:14:03.757Z"
tags: ["CSS", "设计系统", "BEM", "Tailwind", "工程实践"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# CSS 架构与设计系统

CSS 没有作用域、没有模块系统、选择器全局生效——这些特性让小项目写起来很爽，大项目维护起来是噩梦。样式冲突、权重战争、不知道改了这里会不会影响那里，是前端工程里最常见的痛点之一。

CSS 架构解决的问题只有一个：**让样式可预测、可维护**。

---

## 一、BEM：命名即约定

BEM（Block\_\_Element--Modifier）是一种命名规范，通过命名约定模拟作用域。

### 三个概念

```
Block（块）：独立的 UI 组件，如 .card、.button、.nav
Element（元素）：块的组成部分，用 __ 连接，如 .card__title、.card__image
Modifier（修饰符）：状态或变体，用 -- 连接，如 .button--primary、.card--featured
```

### 反例与正例

```html
<!-- ❌ 通用类名，极易冲突，无法看出组件归属 -->
<div class="card">
  <div class="title">标题</div>
  <div class="content active">内容</div>
  <button class="btn blue large">操作</button>
</div>

<!-- ✅ BEM：类名自带上下文，一眼看出结构关系 -->
<div class="card card--featured">
  <div class="card__title">标题</div>
  <div class="card__content card__content--expanded">内容</div>
  <button class="button button--primary button--large">操作</button>
</div>
```

```scss
// ❌ 层级嵌套模拟作用域，选择器权重高，难以覆盖
.card {
  .title { font-size: 18px; }
  .content { color: #333; }
  &.active { background: blue; }
}

// ✅ BEM：扁平结构，权重统一（全是单类选择器）
.card { ... }
.card__title { font-size: 18px; }
.card__content { color: #333; }
.card--featured { background: blue; }
```

### BEM 的边界

BEM 适合纯 HTML/CSS 或 Vue/React 的全局公共样式，但对于组件内部样式，CSS Modules 是更好的选择。

---

## 二、CSS Modules vs CSS-in-JS vs 原子化

三种主流方案各有适用场景，理解取舍再选型。

### CSS Modules

编译时自动生成唯一类名，天然作用域隔离：

```vue title="src/components/Card/index.vue"
<template>
  <div :class="$style.card">
    <h2 :class="$style.title">{{ title }}</h2>
  </div>
</template>

<style module>
.card {
  padding: 16px;
  border-radius: 8px;
}
.title {
  font-size: 18px;
  font-weight: 600;
}
</style>
```

编译后类名变为 `.Card_card_a1b2c3`，不会与其他组件冲突。

**优点**：写法与普通 CSS 一样，无学习成本；编译时处理，无运行时开销。  
**缺点**：动态样式需要配合 CSS 变量；跨组件共享样式需要 `:global`。

### CSS-in-JS（以 styled-components 为例）

样式写在 JS 里，可以直接使用组件 props：

```tsx
import styled from 'styled-components'

const Button = styled.button<{ variant: 'primary' | 'danger' }>`
  padding: 8px 16px;
  border-radius: 4px;
  background: ${props => props.variant === 'primary' ? '#1890ff' : '#ff4d4f'};
  color: white;

  &:hover {
    opacity: 0.85;
  }
`

// 使用
<Button variant="primary">确认</Button>
<Button variant="danger">删除</Button>
```

**优点**：样式与逻辑高度内聚；动态样式天然支持。  
**缺点**：运行时有性能开销；SSR 需要额外配置；打包体积增大。

### 原子化 CSS（Tailwind）

预先生成大量单一职责的工具类，组合使用：

```html
<!-- ❌ 需要命名、需要写 CSS 文件 -->
<div class="user-card">
  <img class="user-avatar" />
  <div class="user-info">...</div>
</div>

<!-- ✅ Tailwind：直接在 HTML 里组合，无需命名 -->
<div class="flex items-center gap-3 p-4 rounded-lg shadow-sm bg-white">
  <img class="w-10 h-10 rounded-full" />
  <div class="flex flex-col gap-1">...</div>
</div>
```

**优点**：无需命名；CSS 文件体积极小（PurgeCSS 自动清理）；设计一致性强。  
**缺点**：HTML 可读性下降；需要学习类名语法；高度定制化场景不灵活。

### 选型建议

| 场景 | 推荐方案 |
|------|---------|
| Vue 单文件组件 | CSS Modules（scoped）或 Tailwind |
| React 组件库 | CSS Modules 或 CSS-in-JS |
| 业务系统快速开发 | Tailwind |
| 需要主题切换 | CSS 自定义属性 + 任意方案 |
| 纯 HTML 项目 | BEM |

---

## 三、CSS 自定义属性（Token 体系）

CSS 自定义属性（`--variable`）是实现设计 token 体系的基础，让颜色、间距、字体在整个系统里统一管理，主题切换只改变量值。

### 基础用法

```css
/* ❌ 魔法数字散落各处，改色要全局搜索替换 */
.button { background: #1890ff; }
.link { color: #1890ff; }
.tag { border-color: #1890ff; }

/* ✅ 定义变量，一处修改处处生效 */
:root {
  --color-primary: #1890ff;
}
.button { background: var(--color-primary); }
.link { color: var(--color-primary); }
.tag { border-color: var(--color-primary); }
```

### Token 分层设计

好的 token 体系分三层：**原始值 → 语义 token → 组件 token**。

```css
/* 第一层：原始色板（不直接使用） */
:root {
  --blue-50: #e6f4ff;
  --blue-500: #1890ff;
  --blue-600: #0958d9;
  --red-500: #ff4d4f;
  --gray-100: #f5f5f5;
  --gray-900: #1f1f1f;
}

/* 第二层：语义 token（表达用途，不表达颜色） */
:root {
  --color-primary: var(--blue-500);
  --color-primary-hover: var(--blue-600);
  --color-danger: var(--red-500);
  --color-bg-base: #ffffff;
  --color-text-base: var(--gray-900);
  --color-text-secondary: #666;

  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  --font-size-sm: 12px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
}

/* 第三层：组件 token（只在组件内部使用） */
.button {
  --button-bg: var(--color-primary);
  --button-padding: var(--spacing-sm) var(--spacing-md);
  --button-radius: var(--radius-sm);

  background: var(--button-bg);
  padding: var(--button-padding);
  border-radius: var(--button-radius);
}
```

### 暗色主题切换

```css
/* 亮色主题（默认） */
:root {
  --color-bg-base: #ffffff;
  --color-text-base: #1f1f1f;
  --color-border: #e8e8e8;
}

/* 暗色主题：只需要覆盖语义 token */
[data-theme='dark'] {
  --color-bg-base: #141414;
  --color-text-base: #ffffffd9;
  --color-border: #424242;
}
```

```ts
// 切换主题
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark')
}
```

---

## 四、响应式方案

### 媒体查询断点约定

```css
/* 先写移动端，再用 min-width 扩展 */
.container {
  padding: 16px;        /* 手机 */
}

@media (min-width: 768px) {
  .container {
    padding: 24px;      /* 平板 */
  }
}

@media (min-width: 1200px) {
  .container {
    padding: 32px;      /* 桌面 */
    max-width: 1200px;
    margin: 0 auto;
  }
}
```

用 CSS 变量管理断点，避免魔法数字：

```css
/* ❌ 断点值魔法数字散落在各个组件文件里，有一处不小心写成 750px，行为不一致 */
/* Button.css */
@media (min-width: 768px) { .button { font-size: 16px; } }

/* Card.css */
@media (min-width: 750px) { .card { flex-direction: row; } }  /* 写错了 */

/* Header.css */
@media (min-width: 768px) { .header { height: 64px; } }
```

在 Tailwind 项目里用配置统一管理断点，保证全局一致：

```ts title="tailwind.config.ts"
// ✅ 断点集中定义，所有组件共享同一份配置
export default {
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
    },
  },
}
```

非 Tailwind 项目可以在 SCSS 里统一管理：

```scss title="src/styles/breakpoints.scss"
// ✅ 变量集中定义
$bp-md: 768px;
$bp-lg: 1024px;

// 用变量，改一处生效全局
@media (min-width: $bp-md) { .card { flex-direction: row; } }
@media (min-width: $bp-md) { .button { font-size: 16px; } }
```

### 容器查询（现代方案）

媒体查询基于**视口宽度**，容器查询基于**父元素宽度**，更适合组件级响应式：

```css
/* 声明容器 */
.card-grid {
  container-type: inline-size;
  container-name: card-grid;
}

/* 根据容器宽度，而非视口宽度调整布局 */
@container card-grid (min-width: 600px) {
  .card {
    display: flex;
    flex-direction: row;
  }
}

@container card-grid (min-width: 900px) {
  .card {
    grid-template-columns: 1fr 2fr;
  }
}
```

容器查询的优势在于**组件真正自适应**：同一个 `<Card>` 组件，放在 240px 宽的侧边栏时竖向排列，放在 800px 宽的主内容区时横向排列，不需要父组件传 `layout` prop，也不依赖视口宽度。

:::note[浏览器兼容性]
容器查询在 Chrome 105+、Firefox 110+、Safari 16+ 中受支持，覆盖绝大多数现代浏览器。如需兼容旧版本，降级方案是继续用媒体查询，或通过 JS 检测宽度后动态加 class。
:::

---

## 方案选型矩阵

| 维度 | BEM | CSS Modules | CSS-in-JS | Tailwind |
|------|-----|-------------|-----------|----------|
| 学习成本 | 低 | 低 | 中 | 中 |
| 作用域隔离 | 靠约定 | 编译时保证 | 运行时保证 | 不需要 |
| 动态样式 | 靠变量 | 靠变量 | 原生支持 | 靠变量 |
| 运行时开销 | 无 | 无 | 有 | 无 |
| 主题切换 | CSS 变量 | CSS 变量 | props | CSS 变量 |
| 适合项目规模 | 中小 | 中大 | 中大 | 任意 |
| 适合团队 | 纯 CSS 团队 | Vue/React 团队 | React 团队 | 任意 |
| 浏览器兼容 | 全兼容 | 全兼容 | 全兼容 | 全兼容 |
