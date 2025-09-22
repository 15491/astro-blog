---
title: "OG 社交图片示例"
publishDate: "27 January 2023"
description: "Astro Cactus 的示例文章，详细介绍如何在 frontmatter 中添加自定义社交图片卡"
tags: ["示例", "博客", "图片"]
ogImage: "/social-card.png"
---

## 为文章添加你自己的社交图片

这篇文章是如何为博客文章添加自定义 [open graph](https://ogp.me/) 社交图片（也称为 OG 图片）的示例。
通过在文章的 frontmatter 中添加可选的 ogImage 属性，你可以选择不使用 [satori](https://github.com/vercel/satori) 为这个页面自动生成图片。

如果你打开这个 markdown 文件 `src/content/post/social-image.md`，你会看到 ogImage 属性设置为一个位于 public 文件夹中的图片[^1]。

```yaml
ogImage: "/social-card.png"
```

你可以在[这里](https://astro-cactus.chriswilliams.dev/social-card.png)查看为这个模板页面设置的图片。

[^1]: 图片本身可以放在你喜欢的任何地方。
