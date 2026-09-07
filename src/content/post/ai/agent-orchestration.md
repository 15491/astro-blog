---
title: "Agent 多步推理编排：从 ReAct 循环到 LangGraph 图编排"
description: "什么时候一次工具调用不够用，AI SDK 的 stopWhen 循环、手写 while 循环、顺序交接与 LangGraph 图编排该怎么选"
publishDate: "2026-09-08T10:05:00.000Z"
updatedDate: ""
tags: ["Agent", "ReAct", "LangGraph", "LLM", "架构设计"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# Agent 多步推理编排：从 ReAct 循环到 LangGraph 图编排

工具调用的往返流程（模型请求 → 执行 → 结果喂回）是最基本的单元，但很多真实问题没办法靠一次工具调用解决。"帮我查一下北京今天的天气，如果气温低于 10 度就查一下最近的羽绒服促销信息"——这需要先调用天气工具拿到结果，再根据结果判断要不要调用第二个工具，靠单次调用是做不到的。

本文按复杂度递进，梳理四种编排方式：单个 Agent 的循环推理（ReAct）、多个 Agent 的顺序交接、以及当控制流出现分支和循环交织时该怎么办（LangGraph）。

## ReAct：推理、行动、观察，循环往复

**ReAct**（Reasoning + Acting）描述的是这种多步循环最经典的模式：

1. **Reason（推理）**：模型基于当前已知信息想一想，"接下来该做什么？"
2. **Act（行动）**：如果需要更多信息，调用一个工具。
3. **Observe（观察）**：拿到工具返回的结果，回到第 1 步继续推理。

是否需要循环、循环几轮，都是模型在推理过程中自己决定的，代码只负责"提供工具、执行工具、把结果喂回去、判断什么时候该停"。

判断一个问题是否需要 ReAct 循环，标准很直接：**这个问题能不能靠一次工具调用回答？** 如果答案依赖"先查 A，再根据 A 的结果查 B，可能还要查 C"，就是需要循环的场景。常见例子：需要先定位到某个实体再查详情、需要交叉验证多个数据源、任务描述里包含"如果……就……"这种依赖上一步结果的条件分支。

### 谁来控制循环：AI SDK 自动跑 vs 自己手写

**让 SDK 自动跑**：告诉它"最多允许跑 n 步"，调用一次 `generateText`，内部自动重复"决策 → 执行工具 → 喂回结果"，直到模型不再请求调用工具或达到步数上限：

```ts
const result = await generateText({
  model,
  tools,
  stopWhen: isStepCount(6),
  prompt: "退款政策是什么？src 目录下有没有实现退款相关逻辑的代码？",
});
```

代码量少，适合大多数场景。

**自己手写 `while` 循环**：手动维护消息数组，每一轮手动调用模型、检查是否请求了工具调用、手动执行、手动把结果拼回消息数组：

```ts
let messages: ModelMessage[] = [{ role: "user", content: userInput }];

for (let step = 0; step < maxSteps; step++) {
  const result = await generateText({ model, tools, messages });
  messages.push(...result.response.messages);

  if (result.toolCalls.length === 0) break; // 模型没有再请求工具，说明可以给最终答案了

  // 需要在某一步插入人工审核 / 自定义日志，就在这里加
}
```

代码更多，换来完全的透明度：什么时候该打断、要不要在某一步暂停等待人工确认、要不要在特定条件下提前退出，都由自己掌控。

**权衡点是"要不要透明度换省事"**：快速原型、逻辑相对简单 → 用内置的 `stopWhen`；需要精细控制（人工审核节点、自定义中间日志、特定条件提前退出）→ 手写循环。两者背后是同一个模式，只是循环体谁来写的选择不同。

:::tip[无论哪种方式，步数上限都不是可选项]
没有上限的循环，最坏情况是模型反复调用同一个工具却拿不到满意结果，或者在几个工具之间来回跳转始终不收敛，成本无限增长。`stopWhen: isStepCount(n)` 或手写循环里的 `maxSteps`，是防御性编程的第一道线。
:::

---

## 多智能体的顺序交接：不需要框架也能做到

当一个 system prompt 要同时兼顾太多互相冲突的角色（既要"雷厉风行的代码审查者"又要"耐心的文档写作者"），或者任务天然分阶段且每个阶段需要的能力差别很大（先调研再写作，调研阶段频繁调用搜索工具，写作阶段几乎不需要工具），拆成多个 Agent 会更清晰。

对大多数实际项目，最朴素的**顺序交接（sequential hand-off）**已经够用：A 的输出直接作为 B 的输入，普通的函数调用，一个函数的返回值喂给另一个函数：

```ts
const research = await generateText({
  model,
  tools: { search },
  stopWhen: isStepCount(5),
  prompt: `请调研主题"${topic}"，分别搜索它的历史、语法、生态，并列出关键事实。`,
});

const writing = await generateText({
  model,
  system:
    "你是一个总结助手，请基于以下研究笔记，为普通读者写一段简洁流畅的总结。",
  prompt: research.text,
});
```

不需要引入专门的多智能体框架（Python 生态里的 AutoGen、CrewAI 提供了角色定义、消息路由、任务分解的一整套抽象）——拆分职责、传递上下文、顺序调度这几个核心思想，用最朴素的函数调用就能实现。真的遇到需要"动态决定调用哪个子 Agent"的编排者/执行者模式，再引入框架也不迟。

---

## 什么时候顺序代码开始不够用

顺序交接假设步骤是固定的、线性的。一旦出现下面这类需求，"顺序代码 + if/while"会越写越乱：

- **分支**：根据上一步的结果，走完全不同的后续路径（研究发现资料不够，多做一轮搜索；否则直接进入写作）
- **循环**：反复执行某个步骤直到满足条件——这是"多个步骤/多个子 Agent 之间"的循环，比 ReAct 循环高一个层级
- **状态在多个步骤之间流转**：每一步都可能读取、追加、覆盖同一份共享数据，手写代码很容易在某个分支里漏更新一个字段

LangGraph 把"步骤"和"步骤之间怎么走"拆成两个显式的概念：

- **State**：所有步骤共享的、按 schema 定义的数据结构。字段可以是"直接覆盖"，也可以是"追加式合并"（声明一个 reducer）。
- **Node**：一个普通函数，读取当前 state，返回一份状态更新。
- **Edge**：决定"这一步做完之后去哪个节点"，固定边或者**条件边**（一个函数读取 state，返回下一步该走哪个节点，甚至可以走回自己形成循环）。

```ts
const State = new StateSchema({
  topic: z.string(),
  // 追加式字段：每个节点返回的 researchNotes 会被 concat 到已有数组后面
  researchNotes: new ReducedValue(
    z.array(z.string()).default(() => []),
    {
      reducer: (x, y) => x.concat(y),
    },
  ),
  final: z.string().default(""),
});

const research: GraphNode<typeof State> = (state) => {
  return { researchNotes: ["新发现的一条线索"] };
};

// 条件边：自己决定"再来一轮研究"还是"进入写作"
const routeAfterResearch = (state: typeof State) =>
  state.researchNotes.length < 3 ? "research" : "write";

const write: GraphNode<typeof State> = async (state) => {
  return { final: "总结好的最终答案" };
};

const graph = new StateGraph(State)
  .addNode("research", research)
  .addNode("write", write)
  .addEdge(START, "research")
  .addConditionalEdges("research", routeAfterResearch) // 线索不够就绕回 research 自己
  .addEdge("write", END)
  .compile();
```

`research` 节点每次只拿一条新线索，做完交给 `routeAfterResearch` 判断：线索不够 3 条就绕回自己（循环），够了就去 `write`（分支/终止）。这个"循环 + 分支"的控制流是图定义里一条显式、可读的边，而不是散落在某个节点函数内部的 `if`/`while`。

:::note[LangChain 的 createAgent 是什么关系]
LangChain.js 的高层 API `createAgent()` 内部就是用 LangGraph 搭出来的一个"单 Agent 循环"模板。理解 LangGraph，相当于揭开 `createAgent` 的引擎盖；反过来，如果 `createAgent` 已经够用，完全没必要绕过它自己手搭图。
:::

---

## 三种编排方式的关系

| 方式       | 解决的编排问题                                            | 控制流写在哪                    |
| ---------- | --------------------------------------------------------- | ------------------------------- |
| ReAct 循环 | 单个 Agent 反复调用工具，直到能回答问题                   | `stopWhen`，或手写 `while` 循环 |
| 顺序交接   | 少数几个固定步骤的顺序编排（A 的输出喂给 B）              | 普通同步代码，一步接一步        |
| LangGraph  | 步骤之间有分支/循环，需要显式表达状态如何流转、下一步去哪 | 图的 node/edge 定义             |

三者不是互相替代的关系，而是解决不同复杂度的编排问题。大多数场景 ReAct 循环加顺序交接已经够用，只有真正出现分支和循环交织的编排需求时，才值得引入图编排这一层额外的抽象和依赖——过早引入框架级的编排能力，往往是在给一个本来三行代码能写完的顺序流程增加不必要的心智负担。
