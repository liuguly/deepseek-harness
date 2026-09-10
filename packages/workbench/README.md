---
description: "Personal knowledge workbench: document ingest in two modes, pgvector storage and search, and the browser workbench in the settings surface."
kind: "package-group"
---

# packages/workbench — personal knowledge workbench

English | [中文](README.zh.md)

## Summary

The `workbench/` group turns the harness into a personal knowledge base: document upload in two modes (tokenized chunk knowledge base, question-template pipeline), pgvector-backed storage and vector search, and a browser workbench in the settings surface. The group follows the capability-seam split: `knowledge` declares the store and embedding seams and orchestrates; `knowledge-pgvector` and `knowledge-embedding-openai` provide them; `tool-knowledge-search` consumes the service for the model.

| Package | Role | ctx key |
|---|---|---|
| [`knowledge/`](knowledge/README.md) | Seam declarations, ingest orchestration, search, variant generation, `/api/knowledge.*` routes | provides `ctx.knowledge`; defines `knowledgeStore`, `knowledgeEmbedding` |
| [`knowledge-pgvector/`](knowledge-pgvector/README.md) | pgvector storage provider: database bootstrap, migrations, HNSW search | registers `knowledgeStore` |
| [`knowledge-embedding-openai/`](knowledge-embedding-openai/README.md) | OpenAI-compatible embeddings provider | registers `knowledgeEmbedding` |

## Related documentation

- [Workbench subsystem](../../docs/subsystems/workbench.md) — the data model, pipelines, and difficulty/metadata semantics.
- [Client workbench](../client/ui-workbench/README.md) — the browser half in the settings surface.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
