---
title: "为 Astro Cactus 添加 Webmentions"
description: "本文介绍了在你的网站上添加 webmentions 的过程"
publishDate: "11 Oct 2023"
tags: ["webmentions", "astro", "社交"]
updatedDate: 6 December 2024
pinned: true
---

## 简要指南

1. 按照 [IndieLogin's](https://indielogin.com/setup) 说明，在你的主页上添加到 GitHub 资料和/或电子邮件地址的链接。你可以通过 `src/components/SocialList.astro` 来实现，只需确保在相关链接中包含 `isWebmention` 属性。
2. 在 [Webmention.io](https://webmention.io/) 输入你的网站地址来创建账户。
3. 在 `.env` 文件中添加链接轨道和 API 密钥，分别使用 `WEBMENTION_URL` 和 `WEBMENTION_API_KEY` 作为键名，你可以重命名模板中的 `.env.example` 文件。你也可以在这里添加可选的 `WEBMENTION_PINGBACK` 链接。
4. 访问 [brid.gy](https://brid.gy/) 并登录你想要链接的每个社交账户。
5. 发布和构建你的网站，记得添加 API 密钥，现在它应该可以接收 webmentions 了！

## 什么是 webmentions

简单来说，这是一种通过社交媒体向用户展示谁在你网站的各个页面上点赞、评论、转发等的方式。

这个主题会显示每篇博客文章收到的点赞、提及和回复数量。还有一些我没有包含的 webmentions，比如转发，目前被过滤掉了，但应该不难包含进来。

## 在你自己的网站上添加它的步骤

你需要创建几个账户来让一切运行起来。但是，你需要首先确保的是你的社交链接是正确的。

### 添加到你的资料的链接

首先，你需要在你的网站上添加一个链接来证明所有权。如果你查看 [IndieLogin's](https://indielogin.com/setup) 说明，它给了你 2 个选项，电子邮件地址和/或 GitHub 账户。我创建了组件 `src/components/SocialList.astro`，你可以在 `socialLinks` 数组中添加你的详细信息，只需在相关链接中包含 `isWebmention` 属性，这将添加 `rel="me authn"` 属性。无论你怎么做，都要确保你的标记中有一个链接，按照 IndieLogin's 的[instructions](https://indielogin.com/setup)

```html
<a href="https://github.com/your-username" rel="me">GitHub</a>
```

### 注册 Webmention.io

接下来，访问 [Webmention.io](https://webmention.io/) 并通过输入你的域名来创建账户，例如 `https://astro-cactus.chriswilliams.dev/`。请注意，.app TLD 无法正常工作。登录后，它会为你的域名提供几个链接来接收 webmentions。记下这些并创建一个 `.env` 文件（这个模板包含一个示例 `.env.example` 文件，你可以重命名它）。分别使用 `WEBMENTION_URL` 和 `WEBMENTION_API_KEY` 作为键/值添加链接轨道和 API 密钥，如果需要，还可以添加可选的 `WEBMENTION_PINGBACK` URL。请尽量不要将其发布到仓库！

:::note
你不必包含 pingback 链接。也许是巧合，但在添加它之后，我开始在我的邮箱中收到更高频率的垃圾邮件，告诉我我的网站可以做得更好。说实话，他们没错。我现在已经删除了它，但这取决于你。
:::

### 注册 Brid.gy

现在你要使用 [brid.gy](https://brid.gy/)。正如其名称所示，它将你的网站连接到你的社交媒体账户。对于你想要设置的每个账户（例如 Mastodon），点击相关按钮并连接你希望 brid.gy 搜索的每个账户。再次注意，brid.gy 目前对 .app TLD 有问题。

## 测试一切是否正常工作

设置完成后，现在是时候构建和发布你的网站了。**记住**要在你的主机上设置环境变量 `WEBMENTION_API_KEY` 和 `WEBMENTION_URL`。

你可以通过 [webmentions.rocks](https://webmention.rocks/receive/1) 发送测试 webmention 来检查一切是否正常工作。使用你的域名登录，输入授权代码，然后输入你要测试的页面 URL。例如，要测试这个页面，我会添加 `https://astro-cactus.chriswilliams.dev/posts/webmentions/`。要在你的网站上查看它，重新构建或（重新）启动本地开发模式，你应该在页面底部看到结果。

你也可以通过他们的 [api](https://github.com/aaronpk/webmention.io#api) 在浏览器中查看任何测试提及。

## 要添加的事情，要考虑的事情

- 目前，只有在重新构建或重启开发模式时才会获取新的 webmentions，这显然意味着如果你不经常更新你的网站，你就不会得到很多新内容。添加一个 cron 作业来运行 `src/utils/webmentions.ts` 中的 `getAndCacheWebmentions()` 函数并填充你的博客新内容应该是相当简单的。这可能是我接下来会作为 github action 添加的。

- 我看到一些提及有重复。不幸的是，它们很难过滤，因为它们有不同的 ID。

- 我不太喜欢用于链接到评论/回复的小型外部链接图标。由于尺寸问题，它在移动设备上特别不好，将来可能会改变它。

## 致谢

非常感谢 [Kieran McGuire](https://github.com/chrismwilliams/astro-theme-cactus/issues/107#issue-1863931105) 与我分享这个，以及有用的文章。我以前从没听说过 webmentions，现在通过这次更新，希望其他人也能够使用它们。此外，来自 [kld](https://kld.dev/adding-webmentions/) 和 [ryanmulligan.dev](https://ryanmulligan.dev/blog/) 的文章和示例在设置和集成方面真的很有帮助，如果你正在寻找更多信息，这两个都是很好的资源！
