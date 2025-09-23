#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取文件名参数
const fileName = process.argv[2];

if (!fileName) {
  console.error('错误：请提供文件名');
  console.log('用法: npm run new:note <文件名>');
  console.log('示例: npm run new:note my-note');
  process.exit(1);
}

// 确保文件名以 .md 结尾
const fullFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;

// 生成当前时间的 ISO 字符串
const now = new Date().toISOString();

// Note 模板内容
const noteTemplate = `---
title: ""
description: ""
publishDate: "${now}"
---

`;

// 目标路径
const targetPath = path.join(__dirname, '..', 'src', 'content', 'note', fullFileName);

// 检查文件是否已存在
if (fs.existsSync(targetPath)) {
  console.error(`错误：文件 ${fullFileName} 已存在`);
  process.exit(1);
}

try {
  // 创建文件
  fs.writeFileSync(targetPath, noteTemplate);
  console.log(`✅ 成功创建 note 文件: ${fullFileName}`);
  console.log(`📍 位置: ${targetPath}`);
} catch (error) {
  console.error('创建文件时出错:', error.message);
  process.exit(1);
}