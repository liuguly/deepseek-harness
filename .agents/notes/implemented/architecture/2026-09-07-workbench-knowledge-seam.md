# Agent Note: The workbench knowledge capability seam

Status: implemented

English | [中文](2026-09-07-workbench-knowledge-seam.zh.md)
## Problem

The user needs the harness to act as a personal knowledge base: documents uploaded in two modes (a tokenized chunk knowledge base and a question-template pipeline with per-question variant templates, five difficulty levels, and distilled metadata), stored in their local pgvector instance, searchable from the Web GUI, all without touching harness core.

The harness has no embeddings capability, no pgvector storage, and no generic "add a top-level page" slot in the web shell. A naive build would either modify core packages (forbidden) or bolt a separate app beside the harness (losing the composition, auth, and UI plumbing).

## Decision

Ship the capability as four packages in a new `workbench/` group plus one browser package, following the web family's capability-seam split:

- `dsh-workbench-knowledge` declares the `knowledgeStore` and `knowledgeEmbedding` seams and publishes `ctx.knowledge` (ingest orchestration, search, variant generation, and the exact `/api/knowledge.*` Fetch routes). A missing provider fails the mount through inject waiting.
- `dsh-workbench-knowledge-pgvector` and `dsh-workbench-knowledge-embedding-openai` register the providers; connection facts come from `PGSQL_*` environment expressions so no credential lands in the repository, and the embedding credential uses an `env:` reference.
- `dsh-client-ui-workbench` renders the workbench as a `settings.section` occupant — the sanctioned full-content-area extension point — instead of a new top-level view, which would require core layout changes.

Transport uses exact Fetch routes rather than Typert Remote (the `session-log-export` precedent); the route method union is `GET|HEAD|POST`, so destructive actions are POST bodies. Template-pipeline model calls go through `ctx.llm.stream()` with an explicit composition-configured route (`template.llm`) because no default-route service exists, and they omit the closed `purpose` union instead of extending core types. Difficulty is a structural, indexed column validated against the fixed five-level enum at the JSON boundary; artifact metadata composes into embedding text so document-name and topic terms stay searchable.

## Alternatives considered

- An out-of-tree bundle installed through `dsh plugin add` keeps the harness tree pristine but forfeits the repository's client build pipeline, coverage, and i18n guardrails; rejected once the branch-based workflow removed the upstream-conflict concern.
- Reusing `ctx.fileUpload` receipts for uploads reuses the streaming intake but its receipts are session-scoped and prompt-bound — the wrong lifetime for durable documents.
- Typert Remote typed RPC was deferred: the exact Fetch routes cover the wire with hand-typed shapes, and the Remote generation pipeline is out of proportion for one feature surface.

## Consequences

- The web profile composes four new rows; upgrades from upstream only touch those composition rows.
- The workbench requires `PGSQL_*` environment variables and an embeddings credential (`SILICONFLOW_API_KEY` by default; ARK works once the credential serves `/embeddings`).
- Schema version 1 has no migration path; a dimension change requires dropping the `kb_*` tables (the store names this).
- Re-ingest requires the client to supply the file again; uploads are not persisted server-side.

## Verification

- Store, embedding, pipeline, service, and transport unit tests (32 passing) cover bootstrap idempotence, dimension-mismatch rejection, KNN filters, response alignment, JSON validation with retry-once, per-question failure isolation, dedup, and route admission rules; a real-database integration spec is gated on `DSH_TEST_PGVECTOR_DSN`.
- `dsh --profile web --dump-config` composes all four rows; the client bundle builds; `pnpm run typecheck` and the export-JSDoc, config-catalog, and tsconfig-paths gates pass.
- Live end-to-end rehearsal on `dsh web` (upload → template → filtered search → variant generation) remains for the deployment restart.
