## Context

The harness composes everything from Cordis plugins; the web GUI renders client plugin packages through slots and reaches host features over authenticated exact Fetch routes on `/api`. The workbench branch isolates this change from master. PostgreSQL with pgvector runs at `192.168.1.78:5432` (connection facts in `PGSQL_*` environment variables); the database `dsh_workbench` does not exist yet. The harness's model route (`ctx.llm.stream()`) serves template generation; its `sessionId` and `purpose` options are optional, so no llm-type change is needed. Embeddings have no harness provider yet — an OpenAI-compatible `/embeddings` endpoint is required (ARK attempted first, SiliconFlow `bge-m3` as the provisioned fallback). See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- Zero harness core changes: only new packages, web-app bundle composition rows, aggregate tsconfig entries, and documentation.
- Two upload pipelines with durable, observable state and per-artifact failure isolation.
- A pgvector store that bootstraps its own database, schema, and HNSW indexes idempotently.
- A settings-section workbench usable without any new top-level view slot.

**Non-Goals:**
- OCR for scanned PDFs; hybrid BM25 retrieval; Typert Remote typed RPC; multi-user permissioning; incremental document updates; automatic variant quality assessment.

## Decisions

- **In-repo packages over an out-of-tree bundle.** The workbench branch isolates the change; in-repo packages reuse the repository's client bundle pipeline, coverage, i18n, and client-package gates. An out-of-tree bundle would need its own client build and forgoes those guardrails. Extraction into an out-of-tree bundle stays possible later.
- **Seam split mirrors the web family.** `workbench-knowledge` declares the `knowledgeStore` and `knowledgeEmbedding` provider seams plus orchestration and transport; `knowledge-pgvector` and `knowledge-embedding-openai` register providers; `tool-knowledge-search` is a Consumer. Providers are hard injections of the orchestration service, so a missing provider fails the mount loudly.
- **Exact Fetch routes instead of Typert Remote.** `ctx.connection.fetch.register` supports `GET|HEAD|POST` with buffered or streaming bodies, and the client half is plain page `fetch('/api/...')` — the session-log-export precedent. DELETE is not in the method union, so destructive actions are POST bodies (`documents.delete`, `documents.reingest`). Typert Remote typing is deferred; the wire is hand-typed in the package.
- **Uploads bypass the session-attachment flow.** `ctx.fileUpload` stages receipts against a Session for prompt delivery; documents need durable, session-independent storage. The upload route is a `POST .../documents.upload` streaming route owned by the knowledge package, hashing to a content-addressed staging file under `DSH_HOME/workbench/uploads`.
- **pgvector bootstrap is an idempotent ensure step.** Connect to `postgres`, create `dsh_workbench` when absent (fail loud with admin SQL when the role lacks `CREATEDB`), `CREATE EXTENSION IF NOT EXISTS vector` (fail loud with install guidance when the server lacks pgvector), then apply monotonic `SCHEMA_VERSION` DDL. The vector column dimension comes from config; a mismatch fails at boot with a rebuild path.
- **One OpenAI-compatible embedding provider.** `baseUrl` + `model` + `dimensions` + credential reference make ARK and SiliconFlow the same code path; the credential reaches the provider through a `credentialRef` resolved via the credentials seam, never a literal in config.
- **Model calls use `ctx.llm.stream()` without `purpose`.** The `purpose` union is closed in core types; omitting it (and optional `sessionId`) keeps the core untouched. Text assembles from text blocks; JSON outputs are schema-validated at the boundary with one retry.
- **Difficulty is a structural column.** Five stable codes (`easy|normal|hard|hell|nightmare`) validated at the JSON boundary and stored in a `difficulty` column (indexed) so SQL filters work; localized labels live in the UI locale dictionaries only.
- **Metadata is distilled once per document.** A single document-level call produces the shared metadata block; per-question calls inherit and refine it. Each artifact's embedding text = metadata summary + pattern + constraints + knowledge points, which is what makes document-name and topic terms searchable.
- **UI lives in `settings.section`.** A `list` slot with `{ id: 'knowledge', order, label, inject, children }` registration — the sanctioned full-content-area extension point; no core layout change. Upload progress uses XHR against the streaming route; polling pauses when the page is hidden.

## Risks / Trade-offs

- [pgvector absent on the server] → ensure step fails loudly with the exact install SQL; P1 bring-up verifies before pipeline work.
- [Embedding endpoint lacks an embeddings route (ARK coding token)] → config switches to SiliconFlow `bge-m3`; same provider code path, dimension changes documented.
- [LLM cost of per-question templates] → batching, bounded concurrency, per-question isolation, and configured caps keep one bad document from fanning out unbounded calls.
- [Exact Fetch routes are hand-typed wire] → request/response shapes are typed in the package and covered by component specs; Typert migration deferred with a documented seam.
- [Settings overlay constrains width] → two-pane layout collapses to stacked panes; no overlay replacement.

## Migration Plan

Additive only. First activation creates the database, extension usage, schema, and indexes; no existing harness data is touched. Rollback = stop the new rows; the database remains (documented drop path for full removal).

## Open Questions

- Which embeddings endpoint the ARK credential actually serves — resolved by the P1 bring-up probe; only a config value changes either way.
