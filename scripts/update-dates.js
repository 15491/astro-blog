#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";

/**
 * 自动更新修改过的 markdown 文件的 updatedDate
 */
function updateModifiedDates() {
  console.log(pc.blue("🔄 检查并更新 markdown 文件的 updatedDate..."));

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
      console.log(pc.blue("ℹ️  没有修改的 markdown 文件需要更新"));
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
        console.log(pc.green("✅ 已更新:"), pc.cyan(filePath));
      } catch (err) {
        console.error(pc.red("❌ 更新失败:"), pc.yellow(filePath), pc.gray(err.message));
      }
    });

    if (updatedCount > 0) {
      console.log(
        pc.green("\n🎉 成功更新了"),
        pc.yellow(`${updatedCount}`),
        pc.green("个文件的"),
        pc.cyan("updatedDate"),
      );
    }
  } catch (err) {
    console.error(pc.red("❌ 执行失败:"), pc.gray(err.message));
    process.exit(1);
  }
}

updateModifiedDates();
