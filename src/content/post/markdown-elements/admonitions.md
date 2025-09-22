---
title: "Markdown 警告框"
description: "这篇文章展示了在 Astro Cactus 中使用 markdown 警告框功能"
publishDate: "25 Aug 2024"
updatedDate: "4 July 2025"
tags: ["markdown", "警告框"]
---

## 什么是警告框

警告框（也称为"旁注"）对于提供与你的内容相关的支持和/或补充信息很有用。

## 如何使用它们

要在 Astro Cactus 中使用警告框，请用一对三重冒号 `:::` 包裹你的 Markdown 内容。第一对还应该包含你想要使用的警告框类型。

例如，使用以下 Markdown：

```md
:::note
突出显示用户应该考虑的信息，即使在浏览时也是如此。
:::
```

输出：

:::note
突出显示用户应该考虑的信息，即使在浏览时也是如此。
:::

## 警告框类型

目前支持以下警告框：

- `note` (注意)
- `tip` (提示)
- `important` (重要)
- `warning` (警告)
- `caution` (小心)

### 注意

```md
:::note
突出显示用户应该考虑的信息，即使在浏览时也是如此。
:::
```

:::note
突出显示用户应该考虑的信息，即使在浏览时也是如此。
:::

### 提示

```md
:::tip
可选信息，帮助用户更成功。
:::
```

:::tip
可选信息，帮助用户更成功。
:::

### 重要

```md
:::important
用户成功所必需的关键信息。
:::
```

:::important
用户成功所必需的关键信息。
:::

### 小心

```md
:::caution
行动的负面潜在后果。
:::
```

:::caution
行动的负面潜在后果。
:::

### 警告

```md
:::warning
由于潜在风险而需要用户立即注意的关键内容。
:::
```

:::warning
由于潜在风险而需要用户立即注意的关键内容。
:::

## 自定义警告框标题

你可以使用以下标记自定义警告框标题：

```md
:::note[我的自定义标题]
这是一个带有自定义标题的注意事项。
:::
```

输出：

:::note[我的自定义标题]
这是一个带有自定义标题的注意事项。
:::

## GitHub 仓库卡片
你可以添加链接到 GitHub 仓库的动态卡片，在页面加载时，仓库信息从 GitHub API 中提取。

::github{repo="chrismwilliams/astro-theme-cactus"}

你也可以链接一个 Github 用户：

::github{user="withastro"}

要使用此功能，你只需使用 "Github" 指令：

```markdown title="链接仓库"
::github{repo="chrismwilliams/astro-theme-cactus"}
```

```markdown title="链接用户"
::github{user="withastro"}
```
