---
title: "Markdown 元素合集"
description: "这篇文章用于测试和列出各种不同的 markdown 元素"
publishDate: "22 Feb 2023"
updatedDate: 22 Jan 2024
tags: ["测试", "markdown"]
pinned: true
---

## 这是 H2 标题

### 这是 H3 标题

#### 这是 H4 标题

##### 这是 H5 标题

###### 这是 H6 标题

## 水平线

---

---

---

## 强调

**这是粗体文本**

_这是斜体文本_

~~删除线~~

## 引号

"双引号" 和 '单引号'

## 引用块

> 引用块也可以嵌套...
>
> > ...通过直接相邻使用额外的大于号...

## 参考

一个包含可点击参考[^1]的示例，带有源链接。

第二个包含参考[^2]的示例，带有源链接。

[^1]: 第一个参考脚注，带有返回内容链接。

[^2]: 第二个参考链接。

如果你在 `src/content/post/markdown-elements/index.md` 中查看这个示例，你会注意到参考和“脚注”标题通过 [remark-rehype](https://github.com/remarkjs/remark-rehype#options) 插件被添加到页面底部。

## 列表

无序列表

- 通过以 `+`、`-` 或 `*` 开始一行来创建列表
- 子列表通过缩进 2 个空格来制作：
  - 标记字符改变会强制开始新列表：
    - 悲伤的自由意志
    - 在美丽的伪装中容易
    - 没有变化的一些美丽
- 非常简单！

有序列表

1. 伤痛存在
2. 肉体的覆盖
3. 强制性的温柔排列

4. 你可以使用连续数字...
5. ...或者保持所有数字为 `1.`

从偏移开始编号：

57. foo
1. bar

## 代码

内联 `代码`

缩进代码

    // 一些注释
    代码第 1 行
    代码第 2 行
    代码第 3 行

块代码“围栏”

```
示例文本...
```

语法高亮

```js
var foo = function (bar) {
	return bar++;
};

console.log(foo(5));
```

### 表达式代码示例

添加标题

```js title="file.js"
console.log("标题示例");
```

一个 bash 终端

```bash
echo "一个基本终端示例"
```

高亮代码行

```js title="line-markers.js" del={2} ins={3-4} {6}
function demo() {
	console.log("这一行被标记为已删除");
	// 这一行和下一行被标记为已插入
	console.log("这是第二个插入的行");

	return "这一行使用中性默认标记类型";
}
```

[Expressive Code](https://expressive-code.com/) 可以做比这里展示的更多事情，并且包含很多[自定义](https://expressive-code.com/reference/configuration/)选项。

## 表格

| 选项 | 描述                                                               |
| ------ | ------------------------------------------------------------------------- |
| data   | 传递给模板的数据文件路径。 |
| engine | 用于处理模板的引擎。Handlebars 是默认的。    |
| ext    | 目标文件使用的扩展名。                                      |

### 表格对齐

| 项目         | 价格 | # 库存 |
| ------------ | :---: | ---------: |
| 多汁苹果 | 1.99  |        739 |
| 香蕉      | 1.89  |          6 |

### 键盘元素

| 操作                | 快捷键                                   |
| --------------------- | ------------------------------------------ |
| 垂直分割        | <kbd>Alt+Shift++</kbd>                     |
| 水平分割      | <kbd>Alt+Shift+-</kbd>                     |
| 自动分割            | <kbd>Alt+Shift+d</kbd>                     |
| 在分割之间切换 | <kbd>Alt</kbd> + 箭头键                |
| 调整分割大小      | <kbd>Alt+Shift</kbd> + 箭头键          |
| 关闭分割         | <kbd>Ctrl+Shift+W</kbd>                    |
| 最大化面板       | <kbd>Ctrl+Shift+P</kbd> + 切换面板缩放 |

## 图片

同一文件夹中的图片：`src/content/post/markdown-elements/logo.png`

![Astro 主题 cactus 标志](./logo.png)

## 链接

[来自 markdown-it 的内容](https://markdown-it.github.io/)
