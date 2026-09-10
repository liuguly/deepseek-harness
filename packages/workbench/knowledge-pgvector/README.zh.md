---
description: "个人知识库工作台的 pgvector 存储提供方：数据库引导、单调 schema 迁移、HNSW 索引与最近邻检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-knowledge-pgvector

[English](README.md) | 中文

## 概述

本包注册以 PostgreSQL + pgvector 为底的 `knowledgeStore` 接缝。激活时幂等引导：经 `postgres` 维护库在缺失时创建目标数据库、安装 `vector` 扩展、执行单调 schema 迁移并记录向量维度。维度不符或权限缺失都会带着确切补救方式使挂载失败。

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

```yaml
- id: workbench-knowledge-pgvector
  name: '@deepseek-ai/dsh-workbench-knowledge-pgvector'
  config:
    host: !!js process.env.PGSQL_HOST
    port: !!js Number(process.env.PGSQL_PORT)
    user: !!js process.env.PGSQL_USER
    password: !!js process.env.PGSQL_PASSWORD
    database: 'dsh_workbench'
    dimensions: 1024
```

`dimensions` 必须与 embedding 提供方一致。数据库名与 schema 名须匹配 `^[a-z_][a-z0-9_]*$`；通过校验后才允许进入 DDL 插值。

三张表：`kb_documents`（模式、状态、sha256 去重）、`kb_chunks`（内容、tokens、embedding）、`kb_templates`（kind `document_template|question|question_template|variant`、`parent_id` 派生链、难度、metadata、embedding）。两个 embedding 列各建 HNSW `vector_cosine_ops` 索引。

-----

<a id="understand-the-implementation"></a>
## 理解实现

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config、激活期 ensure、接缝注册 |
| [`src/ensure.ts`](src/ensure.ts) | 建库（容忍并发建库竞争） |
| [`src/store.ts`](src/store.ts) | `KnowledgeStore` 实现与 KNN 查询 |

<a id="further-exploration"></a>
## 进一步探索

- [Workbench 子系统](../../../docs/subsystems/workbench.zh.md) — 数据模型与管线语义。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

未发布 invariant 伴随包：schema 记账在 ensure 流程内断言，每个操作都复查初始化状态。

</details>

<a id="model-experience"></a>
## 模型体验

### pgvector 存储提供方

#### 模型看到什么

什么都不看到。存储提供方不注册工具、提示或会话事件。

#### Token 影响

零 `session` 事件。提供方不创建模型轮次。

#### KV Cache 影响

无。存储引导与查询都在会话日志之外。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- schema 版本 1 暂无迁移；更新的存储会使挂载失败并指明版本。
- 更换维度需删除 `kb_*` 表重建；存储会指明该路径而非自动迁移。
