# 我的博客

基于 [Astro Cactus](https://github.com/chrismwilliams/astro-theme-cactus) 主题构建的个人博客，已完全汉化并优化为中文使用环境。

## ✨ 特性

- 🌐 **完全中文化** - 界面、配置、示例内容全部汉化
- 📝 **自动更新时间** - Git 提交时自动更新文章的 `updatedDate`
- 🎨 **现代化设计** - 简洁优雅的博客主题
- 🔍 **全文搜索** - 内置搜索功能
- 📱 **响应式设计** - 完美支持移动端
- 🌙 **深色模式** - 支持亮色/暗色主题切换
- 📊 **SEO 优化** - 完整的 SEO 配置
- 🚀 **高性能** - 基于 Astro 静态生成

## 🚀 快速开始

### 安装依赖
```bash
pnpm install
```

### 开发环境
```bash
pnpm run dev
```

### 构建部署
```bash
pnpm run build
pnpm run preview
```

## 📝 写作

### 添加博客文章
在 `src/content/post/` 目录下创建 `.md` 文件：

```markdown
---
title: "你的文章标题"
description: "文章描述"
publishDate: "2024-01-01"
tags: ["标签1", "标签2"]
---

# 文章内容

这里写你的文章内容...
```

### 添加笔记
在 `src/content/note/` 目录下创建简短的笔记文件。

## 🔧 配置

主要配置文件：
- `src/site.config.ts` - 网站基本信息
- `src/content.config.ts` - 内容类型配置
- `astro.config.ts` - Astro 框架配置

## 📚 原项目

本项目基于 [Astro Cactus](https://github.com/chrismwilliams/astro-theme-cactus) 主题，感谢原作者 [Chris Williams](https://github.com/chrismwilliams) 的出色工作。

## 📄 许可证

个人博客项目，仅供个人使用。