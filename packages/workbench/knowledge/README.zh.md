---
description: "个人知识库工作台编排：摄取管线、检索、变式生成，以及架在存储与向量接缝之上的 /api 传输。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-knowledge

[English](README.md) | 中文

## 概述

本包是个人知识库工作台能力。它声明两个提供方接缝——`knowledgeStore`（持久的文档、片段与模板产物）与 `knowledgeEmbedding`（向量）——并发布编排服务 `ctx.knowledge`：运行摄取管线、应答检索、生成变式题。`/api/knowledge.*` 的精确 Fetch 路由也由本包注册。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载一个存储提供方（见 `knowledge-pgvector`）、一个 embedding 提供方（见 `knowledge-embedding-openai`）和本包。两者的向量维度必须一致，否则编排服务在挂载期报错。

```yaml
- id: workbench-knowledge
  name: '@deepseek-ai/dsh-workbench-knowledge'
  config:
    store: { backend: 'pgvector' }
    embedding: { provider: 'openai-compatible' }
    template:
      llm:
        provider: 'deepseek-official'
        model: 'deepseek-chat'
```

`template.llm` 指定模板管线全部模型调用所走的路由；部署没有全局默认路由服务，组合必须显式给出。分块、模板、生成、上传、检索的边界均为带默认值的校验配置字段。

路由：`POST /api/knowledge.documents.upload?mode=&name=`（流式体）、`GET /api/knowledge.documents`、`POST /api/knowledge.documents.delete`、`POST /api/knowledge.documents.reingest?id=`、`POST /api/knowledge.search`、`POST /api/knowledge.templates.generate`、`GET /api/knowledge.artifacts?documentId=|parentId=`。方法集合为 `GET|HEAD|POST`，因此破坏性操作走 POST 体。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | 接缝与领域契约 |
| [`src/index.ts`](src/index.ts) | Config、`KnowledgeService` 与 `apply` |
| [`src/parse/`](src/parse/index.ts) | 各格式解析器（md/txt/pdf/docx/html），产出标题/文本块 |
| [`src/chunk.ts`](src/chunk.ts) | 标题感知与递归重叠分块 |
| [`src/tokenize.ts`](src/tokenize.ts) | `Intl.Segmenter` 中文分词 |
| [`src/ingest.ts`](src/ingest.ts) | 串行化的摄取状态机 |
| [`src/template-pipeline.ts`](src/template-pipeline.ts) | 元数据、文档模板、题目抽取、变式模板 |
| [`src/llm.ts`](src/llm.ts) | 经 `ctx.llm.stream` 的一次性模型调用与 JSON 提取 |
| [`src/transport.ts`](src/transport.ts) | 精确 Fetch 路由 |

-----

<a id="further-exploration"></a>
## 进一步探索

- [Workbench 子系统](../../../docs/subsystems/workbench.zh.md) — 数据模型与管线语义。
- [web-app bundle patch](../../bundle/web-app/cordis.patch.yml) — 随部署发布的组合行。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

未发布 invariant 伴随包：本包不拥有可发生分歧观察的跨对象关系；存储提供方在自己的 ensure 流程中校验 schema 状态。

</details>

<a id="model-experience"></a>
## 模型体验

### 知识库工作台路由与服务

#### 模型看到什么

什么都不看到。本包不注册工具、提示段或会话事件；模型不可见工作台。

#### Token 影响

零 `session` 事件。这里的任何能力都不会创建模型轮次。

#### KV Cache 影响

无。路由与编排都在会话日志之外，不改变派生的请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 变式生成提示词就地渲染；UI 中 payload 以 JSON 呈现，专用渲染器后续提供。
- Fetch 路由方法集合不含 `DELETE`，破坏性操作以 POST 体表达。
- `GenerateOptions` 的 `purpose` 联合类型在 `dsh-llm` 中封闭；管线调用不带 purpose。
- 重新导入需要客户端再次提供文件；上传文件不做服务端持久化。
