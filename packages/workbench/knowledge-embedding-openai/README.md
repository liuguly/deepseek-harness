---
description: "OpenAI-compatible embeddings provider for the personal knowledge workbench: batched /embeddings calls with dimension enforcement and one immediate retry."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-knowledge-embedding-openai

English | [中文](README.zh.md)

## Summary

This package registers the `knowledgeEmbedding` seam over any OpenAI-compatible `/embeddings` endpoint (SiliconFlow, ARK, OpenAI —nly configuration differs). Batches of texts post sequentially with browser-grade progress semantics; every returned vector is checked against the configured dimension and finiteness before use.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yaml
- id: workbench-knowledge-embedding-openai
  name: '@deepseek-ai/dsh-workbench-knowledge-embedding-openai'
  config:
    baseUrl: 'https://api.siliconflow.cn/v1'
    model: 'BAAI/bge-m3'
    dimensions: 1024
    credentialRef: 'env:SILICONFLOW_API_KEY'
```

`credentialRef` currently accepts `env:<NAME>` only: the variable must exist in the harness process environment, and a missing value fails the mount.


<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| ["src/index.ts"](src/index.ts) | Config, activation, and seam registration |
| ["src/index.ts" batch path](src/index.ts) | Batched /embeddings client with dimension enforcement |


<a id="further-exploration"></a>
## Further Exploration

- [Workbench subsystem](../../../docs/subsystems/workbench.md) — the data model and pipeline semantics.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers —lick to expand</summary>

No invariant companion is published: response alignment and dimension checks are enforced per call at the boundary.

</details>

<a id="model-experience"></a>
## Model Experience

### OpenAI-compatible embeddings provider

#### What the model sees

Nothing. The provider registers no tools, prompts, or session events.

#### Token effect

Zero `session` events. Embedding calls create no model turn.

#### KV Cache effect

None. Embedding requests and responses stay outside the session log.

## Known Limitations and Deferred Work

- `env:` is the only credential reference; the credentials seam generalization is deferred.
- Batching is sequential by design (provider rate limits); a concurrency knob is deferred until a consumer needs it.
