---
description: "pgvector storage provider for the personal knowledge workbench: database bootstrap, monotonic schema migrations, HNSW indexes, and nearest-neighbour search."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-knowledge-pgvector

English | [中文](README.zh.md)

## Summary

This package registers the `knowledgeStore` seam backed by PostgreSQL with pgvector. On activation it bootstraps idempotently: it creates the configured database when absent (connecting through the `postgres` maintenance database), installs the `vector` extension, applies monotonic schema migrations, and records the vector dimension. A dimension mismatch or a missing privilege fails the mount with the exact remediation.

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

`dimensions` must equal the embedding provider's dimension. Database and schema names must match `^[a-z_][a-z0-9_]*$`; both are interpolated into DDL only after that validation.

The three tables: `kb_documents` (mode, status, sha256 dedup), `kb_chunks` (content, tokens, embedding), and `kb_templates` (kind `document_template|question|question_template|variant`, `parent_id` chain, difficulty, metadata, embedding). The two embedding columns carry HNSW `vector_cosine_ops` indexes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Config, activation-time ensure, and seam registration |
| [`src/ensure.ts`](src/ensure.ts) | Database creation with the concurrent-create race tolerated |
| [`src/store.ts`](src/store.ts) | The `KnowledgeStore` implementation and KNN queries |


<a id="further-exploration"></a>
## Further Exploration

- [Workbench subsystem](../../../docs/subsystems/workbench.md) — the data model and pipeline semantics.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers —lick to expand</summary>

No invariant companion is published: schema bookkeeping is asserted inside the ensure pass, and every operation re-checks initialization.

</details>

<a id="model-experience"></a>
## Model Experience

### pgvector store provider

#### What the model sees

Nothing. The store registers no tools, prompts, or session events.

#### Token effect

Zero `session` events. The provider creates no model turn.

#### KV Cache effect

None. Storage bootstrap and queries stay outside the session log.

## Known Limitations and Deferred Work

- Schema version 1 has no migrations yet; a newer store fails the mount with the version named.
- Rebuilding for a new dimension means dropping the `kb_*` tables; the store names that path instead of migrating.
