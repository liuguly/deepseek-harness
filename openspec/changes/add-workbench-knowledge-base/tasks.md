## 1. Bring-up probes

- [x] 1.1 Probe the pgvector server with the new `pg` dependency: connect to `postgres` at `PGSQL_HOST:PGSQL_PORT` as `PGSQL_USER`, create `dsh_workbench`, `CREATE EXTENSION vector`, confirm `CREATEDB` behavior, and record the result (verify: probe script output shows database and extension present)
- [x] 1.2 Probe the embeddings endpoint: attempt ARK `/embeddings` with `VOLCES_AUTH_TOKEN`, else verify SiliconFlow `bge-m3`; record working `baseUrl`/`model`/`dimensions` (verify: probe returns a vector of the configured dimension)

## 2. Storage foundation

- [x] 2.1 Scaffold `packages/workbench/knowledge` (service definition, Config schema, store/embedding seam types) and verify it resolves in the Loader topology test (verify: package unit tests green)
- [x] 2.2 Implement `packages/workbench/knowledge-pgvector`: connection pool, idempotent ensure (database, extension, `SCHEMA_VERSION` DDL, HNSW indexes, dimension check) and verify with unit tests plus a `DSH_TEST_PGVECTOR_DSN`-gated integration spec (verify: tests green; self-skip without DSN)
- [x] 2.3 Implement store operations: document upsert/status transitions, chunk and template inserts, KNN search with kind/mode/difficulty/document filters, delete and re-ingest clearing (verify: store unit tests green)
- [x] 2.4 Implement `packages/workbench/knowledge-embedding-openai`: batched `/embeddings` client, dimension probe, retry, credential reference resolution (verify: unit tests green with a mocked endpoint)

## 3. Ingest pipelines

- [x] 3.1 Implement parsers for md/txt/pdf/docx/html with structure extraction and scanned-PDF low-text failure; verify per-format fixtures in unit tests (verify: parser tests green)
- [x] 3.2 Implement chunkers (heading-aware merge, recursive overlap) and `Intl.Segmenter` tokenization with caps; verify chunk-boundary tests (verify: chunker tests green)
- [x] 3.3 Implement the document state machine with staging files, hashing, dedup, concurrency bounds, and restart-interrupted recovery (verify: state-machine tests green)
- [x] 3.4 Implement the template pipeline: metadata distillation, document template, windowed question extraction, per-question variant templates with five-level difficulty and generation prompts, per-question isolation (verify: pipeline tests with mocked llm green)

## 4. Transport surface

- [x] 4.1 Register exact Fetch routes: `POST documents.upload` (streaming), `GET documents`, `POST documents.delete`, `POST documents.reingest`, `POST search`, `POST templates.generate` (verify: route unit tests green)
- [x] 4.2 Wire variant generation through `ctx.llm.stream()` with difficulty placeholder filling and variant archival (verify: generation tests with mocked llm green)

## 5. Browser workbench

- [x] 5.1 Scaffold `packages/client/ui-workbench` per the client package checklist (dsh.client manifest, clientBundle build, tsconfig aggregate, locale namespace) (verify: `pnpm --filter @deepseek-ai/dsh-client-ui-workbench bundle` succeeds)
- [x] 5.2 Implement the settings.section registration and two-pane workbench shell with locale dictionaries zh/en (verify: component specs green)
- [x] 5.3 Implement the upload queue (mode selection, XHR progress, per-file state, retry) against the upload route (verify: component specs green)
- [x] 5.4 Implement the document library (list, mode/name filter, delete confirmation, re-ingest, document-linked search filtering) (verify: component specs green)
- [x] 5.5 Implement search with kind and five-level difficulty chips, kind-specific result cards, and in-card variant generation with history (verify: component specs green)

## 6. Composition and documentation

- [x] 6.1 Wire web-app bundle rows and dependencies; add aggregate tsconfig references; run `pnpm install` (verify: `dsh --profile web --dump-config` lists the new rows)
- [x] 6.2 Add `packages/workbench/README.md`, `packages/client/README.md` and `packages/README.md` rows, `docs/subsystems/workbench.md`, and the Agent Note (verify: `pnpm run doc-sync` passes)
- [ ] 6.3 Scaffold `packages/workbench/tool-knowledge-search` behind a user preset row (phase-2 opt-in, disabled by default) (verify: dump-config shows the disabled row; preset mount validation passes when enabled)

## 7. Verification

- [ ] 7.1 Run the narrow gates: focused tests, `pnpm run test:gui`, typecheck, lint (verify: all green)
- [ ] 7.2 Run `DSH_SNAPSHOT=replay pnpm run test:web` and the REAL-composition boot test for the host stack (verify: green)
- [ ] 7.3 Live rehearsal on `dsh web`: upload one markdown and one exam document in both modes, search with difficulty filters, generate variants from a template card (verify: observed behavior matches specs)
- [ ] 7.4 Run `openspec validate --change add-workbench-knowledge-base --strict` and archive after acceptance (verify: validate green; archived)
