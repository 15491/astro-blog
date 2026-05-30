# Repository Guidelines

## 项目结构与模块组织

- `src/`：站点源码（Astro + TypeScript）。
  - `src/pages/`：路由页面（如 `posts/`、`notes/`、`tags/`、`rss.xml.ts`）。
  - `src/components/`：可复用组件（布局 `layout/`、博客相关 `blog/` 等）。
  - `src/layouts/`：页面布局模板（如 `Base.astro`、`BlogPost.astro`）。
  - `src/content/`：内容源文件（Markdown/MDX）。
    - `src/content/post/`：文章；`src/content/note/`：笔记；`src/content/tag/`：标签。
  - `src/plugins/`：remark/rehype 插件；`src/styles/`：全局与组件样式。
- `public/`：静态资源（构建时原样输出）。
- `scripts/`：内容辅助脚本（新建文章/笔记、更新 `updatedDate`）。

## 构建、测试与开发命令（pnpm）

- `pnpm install`：安装依赖。
- `pnpm run dev`（或 `pnpm start`）：本地开发服务器。
- `pnpm run build`：生产构建；会触发 `postbuild` 运行 `pagefind --site dist` 生成站内搜索索引。
- `pnpm run preview`：本地预览构建产物。
- `pnpm run check`：Astro/TS 类型与内容检查（CI 里建议必跑）。
- `pnpm run lint`：Biome 代码规范检查。
- `pnpm run format`：统一格式化（`format:code` 用 Biome，`format:md` 用 Prettier）。
- `pnpm run new:post "标题"` / `pnpm run new:note "标题"`：生成内容模板。
- `pnpm run update-dates`：根据 Git 修改记录更新文章 `updatedDate`。

## 代码风格与命名约定

- 基础约定见 `.editorconfig`：2 空格缩进、LF、UTF-8、去尾空格。
- 使用 Biome（`biome.json`）作为主要格式化/检查工具：双引号、分号、行宽 100；`.astro` 文件有特定规则覆盖。
- Markdown/MDX 使用 Prettier：行宽 80；提交前优先运行 `pnpm run format`。

## 测试与验证

- 当前仓库未配置专门的单元/端到端测试框架；主要依赖 `pnpm run check`、`pnpm run lint`、以及 `pnpm run build` 的构建验证。
- UI 或路由变更建议手动验证：`pnpm run dev` 浏览关键页面（首页、文章详情、标签页、RSS、OG 图）。

## 内容写作与 Frontmatter

- 文章位于 `src/content/post/`，笔记位于 `src/content/note/`；文件名建议使用 `kebab-case`（例如 `my-first-post.md`），并避免与已有 slug 重名。
- `post` 需要 `title`、`description`、`publishDate`、`tags` 等字段；`note` 的 `publishDate` 需要带时区的 ISO 8601（例如 `2024-01-01T00:00:00+08:00`）。
- 示例（文章）：

```md
---
title: "示例标题"
description: "一句话概述"
publishDate: "2024-01-01"
tags: ["astro", "ts"]
draft: false
---
```

## 提交与 Pull Request 规范

- 提交信息遵循 Conventional Commits 风格：`feat:` / `fix:` / `style:` / `doc:` / `chore:`（正文可用中文）。
- PR 建议包含：变更说明、关联问题/链接、影响页面截图（涉及样式/布局时）、以及运行结果（`check/lint/build`）。
- 依赖变更需一并提交 `pnpm-lock.yaml`；不要提交 `dist/`、`.astro/`、`node_modules/`。

## 配置与安全提示

- 站点元信息：`src/site.config.ts`；内容集合 schema：`src/content.config.ts`；Astro 集成/构建：`astro.config.ts`。
- 新增环境变量时，优先在 `astro.config.ts` 的 `env.schema` 中声明并在 README/PR 中说明用途与默认值。
