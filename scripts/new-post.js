#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取文件名和子目录参数
const fileName = process.argv[2];
const subDir = process.argv[3];

if (!fileName) {
  console.error(pc.red("❌ 错误：请提供文件名"));
  console.log(
    pc.cyan("用法:"),
    pc.white("npm run new:post"),
    pc.yellow("<文件名>"),
    pc.gray("[子目录]"),
  );
  console.log(pc.cyan("示例:"), pc.white("npm run new:post"), pc.yellow("my-article"));
  console.log(
    pc.cyan("示例:"),
    pc.white("npm run new:post"),
    pc.yellow("my-article"),
    pc.blue("network"),
  );
  process.exit(1);
}

// 确保文件名以 .md 结尾
const fullFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;

// 生成当前时间，使用 ISO 格式
const now = new Date();
const publishDate = now.toISOString();

// Post 模板内容
const postTemplate = `---
title: ""
description: ""
publishDate: "${publishDate}"
updatedDate: ""
tags: []
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

`;

// 构建目标路径
const basePath = path.join(__dirname, "..", "src", "content", "post");
const targetDir = subDir ? path.join(basePath, subDir) : basePath;
const targetPath = path.join(targetDir, fullFileName);

// 确保目录存在
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(pc.blue("📁 创建目录:"), pc.gray(targetDir));
}

// 检查文件是否已存在
if (fs.existsSync(targetPath)) {
  console.error(pc.red("❌ 错误：文件"), pc.yellow(fullFileName), pc.red("已存在"));
  process.exit(1);
}

try {
  // 创建文件
  fs.writeFileSync(targetPath, postTemplate);
  console.log(pc.green("✅ 成功创建 post 文件:"), pc.cyan(fullFileName));
  if (subDir) {
    console.log(pc.blue("📂 子目录:"), pc.magenta(subDir));
  }
  console.log(pc.gray("📍 位置:"), pc.dim(targetPath));
} catch (error) {
  console.error(pc.red("❌ 创建文件时出错:"), pc.yellow(error.message));
  process.exit(1);
}
