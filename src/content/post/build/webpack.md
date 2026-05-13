---
title: "Webpack 核心原理与实践"
description: "深入理解 webpack 核心概念、常用配置、loader 与 plugin 机制、构建优化策略，以及如何编写自定义 plugin"
publishDate: "2026-05-14T00:00:00.000Z"
updatedDate: ""
tags: ["webpack", "构建工具", "loader", "plugin", "优化"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Webpack 核心原理与实践

Webpack 是目前生态最完整的前端打包工具，核心工作是以入口文件为起点，递归分析所有依赖，将各种资源（JS、CSS、图片、字体等）打包成浏览器可运行的静态文件。

## 核心概念

### Entry — 入口

Webpack 从 entry 出发，递归解析所有依赖，构建**依赖图（Dependency Graph）**。

```js
// 单入口
module.exports = {
  entry: './src/index.js',
}

// 多入口（多页应用）
module.exports = {
  entry: {
    app: './src/app.js',
    admin: './src/admin.js',
  },
}
```

### Output — 输出

```js title="webpack.config.js"
const path = require('path')

module.exports = {
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    clean: true,
  },
}
```

:::tip[contenthash vs chunkhash]
`contenthash` 只与文件内容相关，内容不变则 hash 不变，适合长期缓存。`chunkhash` 与整个 chunk 相关，chunk 内任一模块变化都会导致 hash 变化。生产环境推荐用 `contenthash`。
:::

### Mode — 模式

```js
module.exports = {
  mode: 'production', // development | production | none
}
```

| mode | 效果 |
| --- | --- |
| `development` | 开启 source map、HMR，不压缩代码，构建速度快 |
| `production` | 自动开启 tree shaking、代码压缩、Scope Hoisting |
| `none` | 不做任何默认优化 |

### Loader — 文件转换

Webpack 原生只能处理 JS 和 JSON，其他类型文件需要通过 loader 转换。

```js title="webpack.config.js" {8}
module.exports = {
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'], // 从右到左执行
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        type: 'asset/resource', // webpack 5 内置，替代 file-loader
      },
    ],
  },
}
```

:::warning[Loader 执行顺序]
`use` 数组中的 loader 从**右到左**（从下到上）执行。上面的 CSS 规则中，`css-loader` 先解析 `@import` 和 `url()`，再由 `style-loader` 将样式注入 DOM。顺序写反会报错。
:::

### Plugin — 扩展构建流程

Plugin 作用于整个构建生命周期，可以做 loader 做不到的事：生成 HTML、提取 CSS 文件、注入环境变量等。

```js title="webpack.config.js"
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const { DefinePlugin } = require('webpack')

module.exports = {
  plugins: [
    new HtmlWebpackPlugin({ template: './public/index.html' }),
    new MiniCssExtractPlugin({ filename: '[name].[contenthash:8].css' }),
    new DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    }),
  ],
}
```

---

## 完整配置示例

```js title="webpack.config.js"
const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

const isProd = process.env.NODE_ENV === 'production'

module.exports = {
  mode: isProd ? 'production' : 'development',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js'],
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  module: {
    rules: [
      { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
      {
        test: /\.css$/,
        use: [
          isProd ? MiniCssExtractPlugin.loader : 'style-loader',
          'css-loader',
          'postcss-loader',
        ],
      },
      { test: /\.(png|svg|jpg|gif|woff2?)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: './public/index.html' }),
    ...(isProd ? [new MiniCssExtractPlugin({ filename: '[name].[contenthash:8].css' })] : []),
  ],
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  devtool: isProd ? false : 'eval-cheap-module-source-map',
}
```

:::note[style-loader vs MiniCssExtractPlugin]
开发模式用 `style-loader` 将 CSS 注入 `<style>` 标签，支持 HMR。生产模式用 `MiniCssExtractPlugin` 提取成独立 `.css` 文件，支持并行加载和浏览器缓存。
:::

---

## 构建优化

### 缓存

```js title="webpack.config.js"
module.exports = {
  cache: {
    type: 'filesystem', // 构建缓存写入磁盘，二次构建速度大幅提升
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: {
          loader: 'babel-loader',
          options: { cacheDirectory: true },
        },
      },
    ],
  },
}
```

### 缩小文件搜索范围

```js
module.exports = {
  resolve: {
    modules: [path.resolve(__dirname, 'src'), 'node_modules'],
    extensions: ['.ts', '.js'], // 后缀越少查找越快
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/, // 不转译 node_modules，速度提升显著
        use: 'babel-loader',
      },
    ],
  },
}
```

### 多线程并行

```js
const TerserPlugin = require('terser-webpack-plugin')

module.exports = {
  module: {
    rules: [
      {
        test: /\.js$/,
        use: ['thread-loader', 'babel-loader'], // thread-loader 放最前，后续 loader 在 worker 中运行
      },
    ],
  },
  optimization: {
    minimizer: [new TerserPlugin({ parallel: true })],
  },
}
```

:::caution[thread-loader 限制]
`thread-loader` 放在它之后的 loader 无法使用 `this.emitFile`、`this.addDependency` 等 API，也无法访问 webpack 的模块系统。只适合耗时的转换操作（如 babel），不适合所有 loader。
:::

### 代码分割（Code Splitting）

```js title="webpack.config.js"
module.exports = {
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
        },
        common: {
          minChunks: 2, // 被至少 2 个 chunk 引用才提取
          name: 'common',
          priority: 5,
        },
      },
    },
    runtimeChunk: 'single', // 将 hash 映射关系单独打包，防止业务变化污染 vendors hash
  },
}
```

### Tree Shaking

Tree Shaking 依赖 ES Module 的静态结构，生产模式下自动开启。

:::important[sideEffects 配置很关键]
如果不声明 `sideEffects`，webpack 会保守地保留所有模块，导致 tree shaking 效果差。在 `package.json` 中声明，让 webpack 更激进地移除无用代码：

```json title="package.json"
{
  "sideEffects": false
}
```

CSS 文件有副作用（直接修改 DOM 样式），需要排除：

```json title="package.json"
{
  "sideEffects": ["*.css", "./src/polyfills.js"]
}
```
:::

### 分析构建产物

```bash
npm install --save-dev webpack-bundle-analyzer
```

```js title="webpack.config.js"
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')

module.exports = {
  plugins: [
    new BundleAnalyzerPlugin(), // 启动本地服务，可视化分析各模块体积
  ],
}
```

---

## Loader 原理与自定义

Loader 本质是一个函数，接收源代码字符串，返回转换后的代码。

```js title="loaders/remove-log.js"
module.exports = function (source) {
  const options = this.getOptions() // 获取用户传入的 options
  return source.replace(/console\.log\(.*?\);?/g, '')
}
```

异步 loader：

```js title="loaders/async-loader.js"
module.exports = function (source) {
  const callback = this.async() // 声明为异步，返回 callback

  someAsyncOperation(source).then(result => {
    callback(null, result) // 第一个参数是 error，第二个是转换结果
  })
}
```

注册使用：

```js title="webpack.config.js"
module.exports = {
  resolveLoader: {
    modules: ['node_modules', path.resolve(__dirname, 'loaders')],
  },
  module: {
    rules: [
      { test: /\.js$/, use: 'remove-log' },
    ],
  },
}
```

---

## Plugin 原理与自定义

### Tapable 钩子系统

Webpack 的插件机制基于 [Tapable](https://github.com/webpack/tapable)，Compiler 和 Compilation 对象上挂载了大量生命周期钩子。

| 钩子 | 触发时机 |
| --- | --- |
| `compiler.hooks.compile` | 开始编译 |
| `compiler.hooks.thisCompilation` | 创建 compilation 对象 |
| `compiler.hooks.emit` | 输出文件前，可修改输出内容 |
| `compiler.hooks.done` | 构建完成 |
| `compilation.hooks.buildModule` | 模块开始构建 |
| `compilation.hooks.optimizeChunks` | 优化 chunk |

### 实现一个自定义 Plugin

Plugin 是一个类，必须实现 `apply(compiler)` 方法。

**示例：构建完成后输出文件清单**

```js title="plugins/FileListPlugin.js"
class FileListPlugin {
  constructor(options = {}) {
    this.filename = options.filename || 'file-list.txt'
  }

  apply(compiler) {
    compiler.hooks.emit.tapAsync('FileListPlugin', (compilation, callback) => {
      const fileList = Object.keys(compilation.assets)
        .map(name => `- ${name} (${compilation.assets[name].size()} bytes)`)
        .join('\n')

      const content = `构建产物清单\n${'='.repeat(20)}\n${fileList}`

      // 向输出目录注入一个新文件
      compilation.assets[this.filename] = {
        source: () => content,
        size: () => content.length,
      }

      callback()
    })
  }
}

module.exports = FileListPlugin
```

**示例：自动注入版本号**

```js title="plugins/InjectVersionPlugin.js"
const { DefinePlugin } = require('webpack')

class InjectVersionPlugin {
  apply(compiler) {
    const { version } = require('./package.json')

    new DefinePlugin({ '__APP_VERSION__': JSON.stringify(version) }).apply(compiler)

    compiler.hooks.done.tap('InjectVersionPlugin', () => {
      console.log(`✅ 构建完成，版本号：${version}`)
    })
  }
}

module.exports = InjectVersionPlugin
```

使用：

```js title="webpack.config.js"
const FileListPlugin = require('./plugins/FileListPlugin')

module.exports = {
  plugins: [new FileListPlugin({ filename: 'assets.txt' })],
}
```

---

## Webpack 构建流程概览

```
初始化参数
    ↓
创建 Compiler，注册所有插件（plugin.apply(compiler)）
    ↓
compiler.run() 开始编译
    ↓
从 entry 出发，调用对应 loader 转换模块
    ↓
递归解析依赖，构建依赖图
    ↓
根据依赖图将模块分配到 chunk
    ↓
对 chunk 进行优化（tree shaking、splitChunks 等）
    ↓
将 chunk 转换为最终输出文件（emit）
    ↓
写入磁盘
```

:::note[理解流程有助于写 Plugin]
Plugin 的本质是在合适的钩子时机插入自定义逻辑。需要修改输出文件内容，用 `emit` 钩子；需要在构建完成后执行，用 `done` 钩子；需要分析模块依赖，用 `compilation.hooks.buildModule`。
:::
