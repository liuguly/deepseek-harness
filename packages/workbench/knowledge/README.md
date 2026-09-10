---
description: "Personal knowledge workbench orchestration: ingest pipelines, search, variant generation, and the /api transport over the store and embedding seams."
kind: "package-reference"
---

# @deepseek-ai/dsh-workbench-knowledge

English | [中文](README.zh.md)

## Summary

This package is the personal knowledge workbench capability. It declares the two provider seams —knowledgeStore` (durable documents, chunks, and template artifacts) and `knowledgeEmbedding` (vectors) —nd publishes `ctx.knowledge`, the orchestration service that runs ingest pipelines, answers searches, and generates question variants. It also owns the exact `/api/knowledge.*` Fetch routes the browser workbench calls.

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

Mount one store provider (see `knowledge-pgvector`), one embedding provider (see `knowledge-embedding-openai`), and this package. The store and embedding rows must agree on the vector dimension; the orchestration fails the mount otherwise.

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

`template.llm` names the model route every template-pipeline call takes; there is no deployment-wide default route service, so the composition must state it. Chunk, template, generation, upload, and search bounds are validated config fields with documented defaults.

The routes: `POST /api/knowledge.documents.upload?mode=&name=` (streaming body), `GET /api/knowledge.documents`, `POST /api/knowledge.documents.delete`, `POST /api/knowledge.documents.reingest?id=`, `POST /api/knowledge.search`, `POST /api/knowledge.templates.generate`, and `GET /api/knowledge.artifacts?documentId=|parentId=`. The method union is `GET|HEAD|POST`, so destructive actions are POST bodies.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| [`src/types.ts`](src/types.ts) | The seam and domain contracts |
| [`src/index.ts`](src/index.ts) | Config, `KnowledgeService`, and `apply` |
| [`src/parse/`](src/parse/index.ts) | Format parsers (md/txt/pdf/docx/html) producing heading/text blocks |
| [`src/chunk.ts`](src/chunk.ts) | Heading-aware and recursive chunking with overlap |
| [`src/tokenize.ts`](src/tokenize.ts) | `Intl.Segmenter` CJK word tokens per chunk |
| [`src/ingest.ts`](src/ingest.ts) | The serialized ingest state machine |
| [`src/template-pipeline.ts`](src/template-pipeline.ts) | Metadata, document template, question extraction, variant templates |
| [`src/llm.ts`](src/llm.ts) | One-shot model calls over `ctx.llm.stream` and JSON extraction |
| [`src/transport.ts`](src/transport.ts) | The exact Fetch routes |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workbench subsystem](../../../docs/subsystems/workbench.md) —he data model and pipeline semantics.
- [web-app bundle patch](../../bundle/web-app/cordis.patch.yml) —he shipped composition rows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers —lick to expand</summary>

No invariant companion is published: the package owns no cross-object relationship whose observations can diverge; the store provider asserts schema state in its own ensure pass.

</details>

<a id="model-experience"></a>
## Model Experience

### Knowledge workbench routes and service

#### What the model sees

Nothing. The package registers no tools, prompt sections, or session events; the model never sees the workbench.

#### Token effect

Zero `session` events. No capability here creates a model turn.

#### KV Cache effect

None. The routes and orchestration live outside the session log and change no derived request prefix.

## Known Limitations and Deferred Work

- Variant generation prompts are rendered in-place; payload rendering in the UI is JSON until a dedicated renderer lands.
- `DELETE` is not in the Fetch-route method union, so destructive actions are POST bodies.
- The `purpose` union on `GenerateOptions` is closed in `dsh-llm`; pipeline calls carry no purpose.
- Re-ingest requires the client to supply the file again; uploads are not persisted server-side.
