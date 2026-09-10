---
description: "个人知识库工作台：双模式文档摄取、pgvector 存储与检索，以及设置页中的浏览器工作台。"
kind: "package-group"
---

# packages/workbench — 个人知识库工作台

[English](README.md) | 中文

## 概述

`workbench/` 组把 harness 变成个人知识库：文档上传分两种模式（分词知识库、出题模板管线），pgvector 存储与向量检索，设置页内的浏览器工作台。本组遵循 capability-seam 拆分：`knowledge` 声明两个接缝并编排；`knowledge-pgvector` 与 `knowledge-embedding-openai` 提供实现。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`knowledge/`](knowledge/README.zh.md) | 接缝声明、摄取编排、检索、变式生成、`/api/knowledge.*` 路由 | 提供 `ctx.knowledge`；定义 `knowledgeStore`、`knowledgeEmbedding` |
| [`knowledge-pgvector/`](knowledge-pgvector/README.zh.md) | pgvector 存储提供方：建库引导、迁移、HNSW 检索 | 注册 `knowledgeStore` |
| [`knowledge-embedding-openai/`](knowledge-embedding-openai/README.zh.md) | OpenAI 兼容 embeddings 提供方 | 注册 `knowledgeEmbedding` |

## Related documentation

- [Workbench 子系统](../../docs/subsystems/workbench.zh.md) — 数据模型、管线、难度与元数据语义。
- [浏览器工作台](../client/ui-workbench/README.zh.md) — 设置页中的浏览器半侧。

## Dev Note

<details>
<summary>维护者上下文 — 点击展开</summary>

None.

</details>
