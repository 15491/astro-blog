#!/usr/bin/env node

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * 自动更新修改过的 markdown 文件的 updatedDate
 */
function updateModifiedDates() {
  try {
    // 获取暂存区中的 markdown 文件
    const stagedFiles = execSync("git diff --cached --name-only --diff-filter=M", {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter((file) => file.match(/\.md$/) && file.startsWith("src/content/"))
      .filter(Boolean);

    if (stagedFiles.length === 0) {
      console.log("没有修改的 markdown 文件需要更新");
      return;
    }

    const now = new Date().toISOString(); // 完整的 ISO 时间格式
    let updatedCount = 0;

    stagedFiles.forEach((filePath) => {
      try {
        const fullPath = path.resolve(filePath);
        let content = fs.readFileSync(fullPath, "utf8");

        // 检查是否已有 updatedDate
        const hasUpdatedDate = /^updatedDate:\s*.+$/m.test(content);

        if (hasUpdatedDate) {
          // 更新现有的 updatedDate
          content = content.replace(/^updatedDate:\s*.+$/m, `updatedDate: "${now}"`);
        } else {
          // 在 publishDate 后添加 updatedDate
          content = content.replace(/^(publishDate:\s*.+)$/m, `$1\nupdatedDate: "${now}"`);
        }

        fs.writeFileSync(fullPath, content, "utf8");

        // 重新添加到暂存区
        execSync(`git add "${filePath}"`);

        updatedCount++;
        console.log(`✅ 已更新: ${filePath}`);
      } catch (err) {
        console.error(`❌ 更新失败: ${filePath}`, err.message);
      }
    });

    if (updatedCount > 0) {
      console.log(`\n🎉 成功更新了 ${updatedCount} 个文件的 updatedDate`);
    }
  } catch (err) {
    console.error("❌ 执行失败:", err.message);
    process.exit(1);
  }
}

updateModifiedDates();
