---
title: "从零实现一个代码文档智能助手：RAG + 工具调用 + 记忆压缩"
description: "基于一个真实跑通的 Agent 项目，拆解 RAG 检索全链路、工具调用与路径安全护栏、常驻 CLI 的上下文压缩与重试退避"
publishDate: "2026-09-08T10:00:00.000Z"
updatedDate: ""
tags: ["Agent", "RAG", "LLM", "向量检索", "工程实践"]
draft: false
pinned: false
ogImage: ""
coverImage:
  src: ""
  alt: ""
---

# 从零实现一个代码文档智能助手：RAG + 工具调用 + 记忆压缩

RAG（检索增强生成）和工具调用（Function Calling）单独拎出来讲都不难，难的是把它们串成一个真正能跑的东西：既要能查资料，又要能验证资料里说的东西在代码里是不是真的存在，还要在多轮对话里不把上下文撑爆、不被模型的幻觉参数搞坏文件系统。

本文基于一个真实跑通的 Agent 项目——一个能回答"某个本地文件夹里的文档和代码写了什么"的命令行工具，按照它的实现顺序，从纯文本切分一路讲到带记忆和容错的常驻 CLI。

## 整体链路

```
用户提问
   │
   ▼
Agent 循环：generateText({ messages, tools, stopWhen: isStepCount(6) })
   │ 按需调用工具（可多步）
   ├── retrieve_context  向量检索，返回最相关的片段
   ├── read_file         读取语料库内某个文件的完整内容
   └── search_files      类似 grep 的子串搜索
   │
   ▼
模型综合工具结果，给出有依据的最终回答
```

整个链路分两条主线：**离线建索引**（切块 → embedding → 存库）和**在线问答**（工具调用 → 综合 → 回答）。下面按实际开发顺序拆开讲。

---

## 一、切块：为检索准备语义单元

切块策略要看数据长什么样。结构清晰的 Markdown 按标题切，天然对应"一个小节讲一件事"；没有明显结构的代码按固定行数切，避免一个 chunk 塞进整个文件导致检索粒度太粗：

```ts title="chunk.ts"
const CODE_CHUNK_LINES = 25;

function chunkMarkdown(content: string): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    // 遇到二级标题就切一刀，把当前累积的内容收进一个 chunk
    if (/^##\s+/.test(line) && current.length > 0) {
      chunks.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) chunks.push(current.join("\n").trim());
  return chunks.filter((chunk) => chunk.length > 0);
}

function chunkCode(content: string): string[] {
  const lines = content.split("\n");
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += CODE_CHUNK_LINES) {
    chunks.push(
      lines
        .slice(i, i + CODE_CHUNK_LINES)
        .join("\n")
        .trim(),
    );
  }
  return chunks.filter((chunk) => chunk.length > 0);
}
```

按扩展名分流即可：`.md` 走标题切分，`.ts`/`.js` 走固定窗口。这一步完全不涉及模型调用，纯文本处理，方便单独测试切块效果对不对。

---

## 二、Embedding 与向量库：不引入外部服务

**Embedding** 可以理解为"把一段文字变成一个能代表它含义的向量"，含义相近的文字，向量在空间中的位置也相近。检索的本质，就是拿问题的向量和库里每个片段的向量算一遍**余弦相似度**，取分数最高的几个。

语料规模只有几十到几百个 chunk 时，不需要 pgvector、Chroma 这类专门的向量数据库，一个 JSON 文件 + 暴力搜索完全够用，还少一层黑盒抽象：

```ts title="vector-store.ts"
export interface VectorRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function search(
  records: VectorRecord[],
  queryEmbedding: number[],
  topK = 3,
): Array<VectorRecord & { score: number }> {
  return records
    .map((record) => ({
      ...record,
      score: cosineSimilarity(record.embedding, queryEmbedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

Embedding 本身也不必依赖云端 API。用 `transformers.js` 在本地跑一个小模型（`Xenova/all-MiniLM-L6-v2`），首次调用下载几十 MB 权重后会被缓存，之后完全离线：

```ts title="embed.ts"
import { pipeline } from "@huggingface/transformers";

let extractorPromise: ReturnType<typeof pipeline> | undefined;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}
```

:::note[normalize: true 的作用]
embedding 输出前先做归一化，向量长度统一为 1，余弦相似度的计算结果才有可比性——否则长度差异会干扰"方向"上的相似度判断。
:::

不需要 `OPENAI_API_KEY` 之类的凭证，也不需要给云端服务发送私有文档内容，本地跑通整条 RAG 链路的成本几乎为零。语料规模变大之后，再考虑换成带 ANN 索引的本地方案（比如 `vectra`），或者真正的向量数据库。

---

## 三、给 Agent 装上工具，而不是把检索焊死在流程里

最朴素的 RAG 是"检索 → 拼 prompt → 生成"三步走的固定流程，问题是模型完全被动，只能看研发预先决定好的检索结果。更进一步的做法是把检索包装成一个**工具**，交给模型自己决定要不要查、查什么、要不要再查一次：

```ts title="agent.ts"
export function buildTools(records: VectorRecord[], corpusRoot: string) {
  return {
    retrieve_context: tool({
      description:
        "在向量索引中检索与查询语义相关的文档/代码片段（RAG 检索）。",
      inputSchema: z.object({
        query: z.string().describe("检索用的自然语言问题或关键词"),
      }),
      execute: async ({ query }) => {
        const queryEmbedding = await embedText(query);
        const results = search(records, queryEmbedding, 3);
        return results
          .map(
            (r) =>
              `[来源: ${r.metadata?.file}, 相关度: ${r.score.toFixed(3)}]\n${r.text}`,
          )
          .join("\n\n");
      },
    }),
    read_file: tool({
      description:
        "读取语料库内某个文件的完整内容，路径相对于语料库根目录，例如 src/refund.ts。",
      inputSchema: z.object({ relativePath: z.string() }),
      execute: async ({ relativePath }) => {
        const target = resolveSafePath(corpusRoot, relativePath);
        if (!target) return `路径 ${relativePath} 超出语料库范围，已拒绝访问。`;
        try {
          return await readFile(target, "utf-8");
        } catch {
          return `文件不存在: ${relativePath}`;
        }
      },
    }),
    search_files: tool({
      description:
        "在语料库全部文件中做子串搜索（类似 grep），返回命中的文件名、行号与内容片段。",
      inputSchema: z.object({ pattern: z.string() }),
      execute: async ({ pattern }) => {
        /* 遍历语料库文件逐行匹配，返回 file:line: content */
      },
    }),
  };
}
```

三个工具分工明确：`retrieve_context` 负责"大概在哪"，`read_file`/`search_files` 负责"精确验证"。比如问"退款政策是什么？`src` 目录下有没有实现退款相关逻辑的代码？"，模型大概率会先检索拿到 FAQ 片段，再用 `search_files` 或 `read_file` 交叉验证代码里确实有对应实现——这正是"多步工具调用"发挥作用的地方，单次检索给不出这种交叉验证的答案。

:::tip[工具描述质量直接决定调用质量]
`description` 不是写给人看的注释，是模型判断"什么时候该调用哪个工具"的唯一依据。三个工具的描述特意点出了各自的适用场景（语义检索 / 精确读取 / 子串搜索），措辞含糊会导致模型选错工具或者压根不知道该调用谁。
:::

---

## 四、安全护栏：工具一旦碰文件系统就要假设参数可能是错的

模型传给 `read_file` 的 `relativePath` 有可能是编造的、越界的路径——哪怕不是故意的，也完全可能生成 `../../.env` 这种参数。任何接受路径参数的工具，在真正执行文件操作前都要校验：

```ts title="agent.ts"
export function resolveSafePath(
  corpusRoot: string,
  relativePath: string,
): string | null {
  const target = resolve(corpusRoot, relativePath);
  const rootWithSep = corpusRoot.endsWith(sep) ? corpusRoot : corpusRoot + sep;
  if (target !== corpusRoot && !target.startsWith(rootWithSep)) return null;
  return target;
}
```

几个容易漏掉的细节：

- `path.resolve(base, path)` 在第二个参数本身是绝对路径时会直接忽略 `base`，所以 `read_file('C:/Windows/System32/...')` 这种绝对路径逃逸，`resolve` 之后自然就不在 `corpusRoot` 下，会被拒绝；`../` 反复上跳同理。
- 比较时特意拼上路径分隔符再 `startsWith`，而不是直接 `target.startsWith(corpusRoot)`——否则 `sample-corpus-evil` 这种和 `sample-corpus` 同前缀的兄弟目录会被误判成"在范围内"。
- 拒绝时返回一句人类可读的提示，而不是抛异常。模型能看到这句提示并据此向用户解释，比进程崩溃或者静默失败体验好得多。

:::caution[护栏要在工具内部做，不能指望 prompt 约束]
在 system prompt 里写"不要访问语料库之外的文件"是不可靠的——这类指令只是降低模型犯错的概率，不是硬约束。真正的边界必须写在代码里，工具自己拒绝越界请求。
:::

---

## 五、常驻 CLI：控制上下文长度，兜住瞬时性失败

从单次问答升级成常驻对话之后，两个新问题会暴露出来：**历史消息越堆越多，迟早撑爆上下文**；**网络抖动或限流会被误判成任务失败**。

**步数上限**：无论单轮工具调用循环跑几步，都要设置硬上限，避免模型在几个工具之间来回跳转却始终不收敛：

```ts
export function runAgentTurn(messages: ChatMessage[], tools: AgentTools) {
  return generateText({
    model: getChatModel("capable"),
    messages,
    tools,
    stopWhen: isStepCount(6),
  });
}
```

**历史摘要压缩**：消息数超过阈值时，把较早的历史（除了最近几条）交给模型压缩成一段摘要，替换掉原始消息，从而把上下文长度控制在一个稳定的范围内：

```ts title="agent.ts"
export async function summarizeOldMessages(
  messages: ChatMessage[],
): Promise<ChatMessage> {
  const toSummarize = messages.slice(0, -4);
  const transcript = toSummarize
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const result = await generateText({
    model: getChatModel("fast"), // 摘要是辅助任务，用便宜快速的模型分级即可
    prompt: `请把下面的对话历史压缩成一段简短的中文摘要，保留关键事实和结论：\n\n${transcript}`,
  });

  return { role: "system", content: `此前对话摘要: ${result.text}` };
}
```

调用方每轮判断一次是否需要压缩，压缩后用摘要替换旧消息，只保留最近几条保证短期上下文完整：

```ts title="index.ts"
if (messages.length > MAX_MESSAGES_BEFORE_SUMMARY) {
  const summary = await summarizeOldMessages(messages);
  messages.splice(0, messages.length - KEEP_RECENT_MESSAGES, summary);
}
```

**重试退避**：网络错误、限流、服务端瞬时故障，通常重试几次就能恢复，间隔递增比立刻重试或直接放弃更稳妥：

```ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}
```

三者组合起来，才是一个"能长期挂着用"的 Agent，而不是一个只能演示一次的 demo：步数上限管成本，摘要压缩管上下文长度，重试退避管稳定性。

---

## 小结

| 阶段      | 要解决的问题                     | 关键手段                                             |
| --------- | -------------------------------- | ---------------------------------------------------- |
| 切块      | 检索粒度太粗或太碎               | Markdown 按标题、代码按固定行数窗口切分              |
| Embedding | 依赖外部服务、隐私数据出域       | 本地小模型（transformers.js），归一化向量            |
| 向量库    | 语料规模小，没必要上重型基础设施 | JSON 文件 + 暴力余弦相似度                           |
| 工具调用  | 检索结果不可验证                 | 把检索包成工具，配合 read_file/search_files 交叉验证 |
| 安全护栏  | 模型参数可能越界或编造           | 路径解析后校验是否仍在根目录内                       |
| 常驻对话  | 上下文无限增长、瞬时性失败       | 步数上限 + 历史摘要压缩 + 指数退避重试               |

这套模式不是 RAG 的专利——任何"模型 + 工具 + 长期运行"的 Agent，最终都要面对同样几个工程问题：检索准不准、越界怎么防、上下文怎么控、失败怎么兜。把这几层拆清楚之后，换一个业务场景（比如换成公司内部的知识库或者别的项目代码库），核心链路几乎不需要改。
