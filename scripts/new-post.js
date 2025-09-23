#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取文件名参数
const fileName = process.argv[2];

if (!fileName) {
  console.error("错误：请提供文件名");
  console.log("用法: npm run new:post <文件名>");
  console.log("示例: npm run new:post my-article");
  process.exit(1);
}

// 确保文件名以 .md 结尾
const fullFileName = fileName.endsWith(".md") ? fileName : `${fileName}.md`;

// 生成当前时间，格式化为易读的日期格式
const now = new Date();
const publishDate = now.toLocaleDateString("en-GB", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

// Post 模板内容
const postTemplate = `---
title: ""
description: ""
publishDate: "${publishDate}"
updatedDate:
tags: []
draft:
pinned: false
ogImage:
coverImage:
  src: ""
  alt: ""
---

`;

// 目标路径
const targetPath = path.join(__dirname, "..", "src", "content", "post", fullFileName);

// 检查文件是否已存在
if (fs.existsSync(targetPath)) {
  console.error(`错误：文件 ${fullFileName} 已存在`);
  process.exit(1);
}

try {
  // 创建文件
  fs.writeFileSync(targetPath, postTemplate);
  console.log(`✅ 成功创建 post 文件: ${fullFileName}`);
  console.log(`📍 位置: ${targetPath}`);
} catch (error) {
  console.error("创建文件时出错:", error.message);
  process.exit(1);
}
