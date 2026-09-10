---
description: "个人知识库工作台的 OpenAI 兼容 embeddings 提供方：带维度校验与一次立即重试的批量 /embeddings 调用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-knowledge-embedding-openai

[English](README.md) | 中文

## 概述

本包在任何 OpenAI 兼容 `/embeddings` 端点（SiliconFlow、ARK、OpenAI——仅配置不同）上注册 `knowledgeEmbedding` 接缝。文本按批顺序发送；每个返回向量都校验维度与有限性后才会使用。

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
- id: workbench-knowledge-embedding-openai
  name: '@deepseek-ai/dsh-workbench-knowledge-embedding-openai'
  config:
    baseUrl: 'https://api.siliconflow.cn/v1'
    model: 'BAAI/bge-m3'
    dimensions: 1024
    credentialRef: 'env:SILICONFLOW_API_KEY'
```

`credentialRef` 目前仅接受 `env:<NAME>`：变量必须存在于 dsh 进程环境，缺失即挂载失败。

<a id="understand-the-implementation"></a>
## 理解实现

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config、激活与接缝注册 |
| [`src/index.ts` 批处理](src/index.ts) | 带维度校验的批量 `/embeddings` 客户端 |

<a id="further-exploration"></a>
## 进一步探索

- [Workbench 子系统](../../../docs/subsystems/workbench.zh.md) — 数据模型与管线语义。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

未发布 invariant 伴随包：响应对齐与维度校验在边界处逐次调用强制执行。

</details>

<a id="model-experience"></a>
## 模型体验

### OpenAI 兼容 embeddings 提供方

#### 模型看到什么

什么都不看到。提供方不注册工具、提示或会话事件。

#### Token 影响

零 `session` 事件。embedding 调用不创建模型轮次。

#### KV Cache 影响

无。embedding 请求与响应都在会话日志之外。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 仅支持 `env:` 凭证引用；credentials 接缝的泛化延后。
- 批处理按顺序执行（尊重提供方限流）；出现需要的消费者前不加并发旋钮。
