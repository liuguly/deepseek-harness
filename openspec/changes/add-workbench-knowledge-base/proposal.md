## Why

The harness currently has no personal knowledge base: documents cannot be uploaded, structured into a local pgvector store, or searched from the Web GUI. The user needs a personal workbench that ingests documents in two upload modes — a tokenized chunk knowledge base and a question-template pipeline — and can turn extracted questions into reusable variant-generation templates with five difficulty levels.

## What Changes

- Add a `workbench/` package group with a `ctx.knowledge` orchestration service, a pgvector storage provider, an OpenAI-compatible embedding provider, and a `knowledge_search` model tool.
- Add a browser half `ui-workbench` that renders a two-pane workbench inside a new Settings section: upload queue, document library, and search with difficulty filters.
- Support two upload modes chosen at upload time: `knowledge` (parse, chunk, tokenize) and `template` (document-level template, question extraction, per-question variant template, metadata + five-level difficulty).
- Persist documents, chunks, and template artifacts (kinds `document_template`, `question`, `question_template`, `variant`) in a new `dsh_workbench` PostgreSQL database with pgvector HNSW indexes; the provider bootstraps the database and schema idempotently.
- Expose authenticated exact Fetch routes under `/api/knowledge.*` for upload, list, search, delete, re-ingest, and variant generation; register a `knowledge_search` tool for sessions via the user preset (phase 2).
- No harness core changes: only new packages, web-app bundle composition rows, aggregate tsconfig entries, and group/subsystem documentation.

## Capabilities

### New Capabilities

- `knowledge-ingest`: Upload modes, document parsing, chunking, tokenization, ingest state machine, and durable document status.
- `knowledge-templates`: Metadata distillation, document-level templates, question extraction, per-question variant templates with difficulty and reusable generation prompts, and variant generation.
- `knowledge-search`: Vector KNN retrieval over chunks and template artifacts with kind/mode/difficulty/document filters.
- `knowledge-workbench-ui`: The Settings-section workbench: upload queue states, document library actions, search filters, result cards, and in-card variant generation.

### Modified Capabilities

None. No existing OpenSpec capabilities change.

## Impact

- New packages: `packages/workbench/knowledge`, `packages/workbench/knowledge-pgvector`, `packages/workbench/knowledge-embedding-openai`, `packages/workbench/tool-knowledge-search`, `packages/client/ui-workbench`.
- Composition wiring: `packages/bundle/web-app/cordis.patch.yml` insert rows, `packages/bundle/web-app/package.json` dependencies, aggregate tsconfig references.
- New npm dependencies: `pg`, `pdfjs-dist`, `mammoth`, `node-html-parser` (scoped to the new packages).
- Runtime prerequisites: PostgreSQL 15+ with pgvector at `192.168.1.78:5432` (connection facts from `PGSQL_*` environment variables), an embeddings endpoint credential (`VOLCES_AUTH_TOKEN`, fallback `SILICONFLOW_API_KEY`).
- Docs: new `packages/workbench/README.md`, `docs/subsystems/workbench.md`, group README table rows, one Agent Note.
