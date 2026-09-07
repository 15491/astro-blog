---
title: "如何封装一个可插拔的 LLM 调用层"
description: "从模型分级、单一接入点到 Provider 抽象粒度选型，梳理如何设计一层薄封装，让业务代码不感知底层用的是哪家大模型"
publishDate: "2026-09-08T10:10:00.000Z"
updatedDate: ""
tags: ["LLM", "SDK", "TypeScript", "架构设计", "Agent"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 如何封装一个可插拔的 LLM 调用层

接入大模型最省事的写法，是在每个用到的地方直接 `new OpenAI()` 或者 `createDeepSeek()`。项目早期这样写没问题，但一旦调用点超过两三处，换厂商、调整超时策略、加日志监控，就要满仓库搜索所有直接 import provider 包的地方——这跟到处 `new axios.create()` 而不做统一封装是同一类问题。

本文讲的不是某个 Agent 概念，而是一个具体的工程设计模式：怎么用一层很薄的封装，把"业务代码要用模型"和"具体用的是哪家、哪个模型"这两件事解耦开。

## 唯一接入点：换厂商只改一个文件

核心思路很简单：全项目只允许有**一个**地方 import provider 的原生包，其他所有业务代码都从这一个模块拿模型实例：

```ts title="model.ts"
import { createDeepSeek } from "@ai-sdk/deepseek";

export type ModelTier = "fast" | "capable" | "best";

const MODEL_IDS: Record<ModelTier, string> = {
  fast: "deepseek-chat", // 日常任务的默认选择
  capable: "deepseek-chat", // RAG、多步推理也用它，够用就不额外分级
  best: "deepseek-reasoner", // 需要更强链式推理的场景（复杂规划）
};

let client: ReturnType<typeof createDeepSeek> | undefined;

function getClient() {
  if (!client) {
    client = createDeepSeek({ apiKey: requireEnv("DEEPSEEK_API_KEY") });
  }
  return client;
}

export function getChatModel(tier: ModelTier = "fast") {
  return getClient()(MODEL_IDS[tier]);
}
```

业务代码只认 `getChatModel('fast' | 'capable' | 'best')`，不知道也不需要知道背后是 DeepSeek 还是别的厂商：

```ts
const result = await generateText({
  model: getChatModel("capable"),
  tools,
  prompt,
});
```

想换成 OpenAI、Anthropic 或其他 provider？只改 `model.ts` 这一个文件，把 `createDeepSeek(...)` 换成对应的 provider 工厂函数，所有调用方自动切换，不需要满仓库改 import。

### 模型分级比直接写死模型名字更耐用

`ModelTier` 这个抽象层看起来多余，实际解决的是"模型名字会变、但调用意图不会变"的问题。业务代码里写的是"这个任务需要多强的能力"（`fast` / `capable` / `best`），而不是"deepseek-chat"这种具体型号——厂商推出新模型、调整定价分级时，只需要改 `MODEL_IDS` 这张映射表，业务代码的调用点完全不用动。

:::tip[单例复用 client 实例]
`getClient()` 用模块级变量缓存，保证同一个 provider client 只创建一次。多数 provider client 内部会做连接复用、鉴权缓存，重复创建是纯浪费。
:::

### 必填配置在使用时才校验，而不是模块加载时

`requireEnv('DEEPSEEK_API_KEY')` 放在 `getClient()` 内部而不是模块顶层，意味着只有真正调用 `getChatModel` 时才会检查环境变量是否存在：

```ts
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}。请检查 .env 配置。`);
  }
  return value;
}
```

好处是运行不需要模型能力的代码路径（比如只跑纯文本切分的单元测试）不会因为缺一个 API key 报错——校验和实际使用的时机绑在一起，而不是"模块被 import 就必须满足所有前置条件"。

---

## 封装粒度怎么选：原生 SDK / 统一接口层 / 全家桶框架

`getChatModel` 这层封装本身依赖的是一个统一接口层（如 Vercel AI SDK 的 `ai` 包），而不是直接对接某个厂商的原生 SDK。选择在哪个粒度上封装，取决于你愿意为"灵活性"付出多少"上手成本"：

|              | 原生 provider SDK                                  | 统一接口层（如 Vercel AI SDK）                    | 全家桶框架（如 LangChain.js）                                |
| ------------ | -------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| 定位         | 官方 SDK，直接对应某一家厂商的 API                 | 统一的多 provider 接口层                          | 内置 Agent、工具、Chain 等一整套抽象                         |
| 控制粒度     | 最细，每个请求参数直接对应 API 文档                | 中等，常见模式封装好，底层请求仍透明              | 较粗，很多行为被框架抽象层接管                               |
| 切换厂商成本 | 高，基本要重写调用代码                             | 低，换个 `model` 参数即可                         | 低，框架本身也做了 provider 抽象                             |
| 上手成本     | 较高，流式、工具调用循环都要自己组装               | 较低，常见模式有现成高层函数                      | 视场景而定，简单场景快，复杂场景要理解框架整套概念           |
| 适合场景     | 需要用到某厂商独有的高级特性，或要对请求做完全定制 | 大多数项目的默认选择：统一接口 + 不想引入过重框架 | 需要开箱即用的复杂编排、大量第三方集成，能接受框架的抽象成本 |

三者不是互斥关系。统一接口层内部对接的正是各家 provider 的原生接口，某天需要用到它暂时没封装的 provider 专属特性，直接绕过它用原生 SDK 发那一次请求也完全可行——不是非此即彼的选择，`getChatModel` 这层薄封装完全可以和"某个特殊调用点直接用原生 SDK"并存。

:::note[全家桶框架也是分层搭建的]
像 LangChain.js 的 `createAgent()` 这类高层 API，内部同样是在更底层的图编排能力上包了一层"单 Agent 循环"模板。框架的抽象程度越高，越值得先搞清楚它下面那一层做了什么，再决定要不要直接用它，还是自己在更底层的接口上薄封装一层——后者往往更贴合项目自己的调用习惯。
:::

---

## 小结

| 设计点      | 解决的问题                               | 实现方式                                         |
| ----------- | ---------------------------------------- | ------------------------------------------------ |
| 唯一接入点  | 换厂商要改一堆调用点                     | 全项目只有一个模块 import provider 原生包        |
| 模型分级    | 模型名字会变，调用意图不会变             | `ModelTier` 映射到具体模型 ID                    |
| 单例 client | 重复创建连接/鉴权浪费资源                | 模块级变量缓存 client 实例                       |
| 延迟校验    | 不需要模型能力的代码路径被迫满足前置条件 | 必填环境变量在实际调用时才检查，不在模块加载时   |
| 封装粒度    | 灵活性和上手成本的取舍                   | 原生 SDK / 统一接口层 / 全家桶框架三选一，不互斥 |

这层封装的价值不在于代码量——`model.ts` 统共 30 多行——而在于它把"厂商选型"这个决策从满仓库的调用点收敛成了一个文件。和封装任何第三方依赖的道理一样：越早做这层隔离，后期换供应商、加监控、做降级的成本就越低。
