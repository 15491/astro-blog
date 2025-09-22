---
title: "唯一标签验证"
publishDate: "30 January 2023"
description: "这篇文章用于验证是否删除重复标签，无论字符串大小写如何"
tags: ["博客", "博客", "博客", "测试", "博客", "测试", "博客"]
---

## 这篇文章是用来测试 zod 转换的

如果你打开文件 `src/content/post/unique-tags.md`，标签数组有多个不同大小写的重复博客字符串。

这些作为 `src/content/config.ts` 中找到的 removeDupsAndLowercase 函数的一部分被删除。
