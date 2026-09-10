# Workbench subsystem

English | [中文](workbench.zh.md)

The workbench subsystem turns uploaded documents into a personal knowledge base stored in PostgreSQL with pgvector and served to the Web settings surface.

## Documents and modes

An upload selects exactly one mode at submit time. `knowledge` mode parses the document (Markdown, plain text, PDF text layer, DOCX heading styles, HTML), chunks it with heading-aware boundaries and configured overlap, tokenizes each chunk with `Intl.Segmenter`, embeds it, and stores chunks. `template` mode parses the document, distills document-level metadata (subject, topic, question type, knowledge points, keywords; grade, year, and source when stated), generates one document question template, extracts existing questions in bounded windows, and generates one variant template per question. Every document carries a durable status (`staged → parsing → chunking → embedding → generating → ready | failed`); transient states become `failed` with reason `interrupted by restart` at boot.

## Difficulty and metadata

Difficulty is a closed five-level enum — `easy`, `normal`, `hard`, `hell`, `nightmare` — stored as a structural, indexed column on template artifacts and validated at the JSON boundary. Localized labels live only in the browser dictionaries. Metadata is distilled once per document, shared by its artifacts, refined per question, and composed into each artifact's embedding text so document-name, subject, topic, and keyword terms are all findable.

## Data model

`kb_documents` (identity, mode, status, sha256 dedup), `kb_chunks` (seq, content, tokens, embedding), `kb_templates` (kind `document_template | question | question_template | variant`, `parent_id` derivation chain, payload, difficulty, metadata, embedding). The two embedding columns carry HNSW `vector_cosine_ops` indexes; the store schema version is monotonic and recorded with the dimension.

## Retrieval and generation

Search embeds the query and runs cosine nearest-neighbour over chunks and artifacts, with structured filters (kind, mode, difficulty, document) and merged, score-ordered results. Variant generation fills a template's `generationPrompt` — whose `{difficulty}` placeholder takes the requested or template difficulty — and archives each generated variant under its template, inheriting metadata and carrying an assessed difficulty.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledgeservice"></a>

### `ctx.knowledge` — `KnowledgeService`

Orchestration over the store and embedding seams. Every public method first awaits `ready()`, which bootstraps the store, recovers interrupted documents, and fails loudly on a dimension mismatch between the configured providers.

```ts cordis-catalog
/**
 * Resolve once the store is bootstrapped, interrupted documents are
 * recovered, and the two seam dimensions agree.
 * @returns resolution when the capability is usable.
 */
ready(): Promise<void>

/**
 * Register and enqueue one document. A repeated upload resolves to the
 * existing record without re-running the pipeline.
 * @param input - the mode, names, content hash, and bytes of the upload.
 * @returns the stored document.
 */
async submitDocument(input: SubmitDocumentInput): Promise<KnowledgeDocument>

/**
 * Re-run one document's pipeline: artifacts are cleared first.
 * @param id - the document id.
 * @param data - the document bytes, supplied again by the client.
 * @param signal - cancellation for the queued pipeline.
 * @returns the document restaged for ingest.
 * @throws when the document does not exist.
 */
async reingestDocument(id: string, data: Uint8Array, signal?: AbortSignal): Promise<KnowledgeDocument>

/**
 * Embed the query and run the nearest-neighbour search across the store.
 * @param input - query text with optional structured filters.
 * @returns results ordered by descending similarity.
 */
async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]>

/**
 * List documents newest first, optionally filtered by mode.
 * @param filter - optional mode filter.
 * @returns the stored documents newest first.
 */
async listDocuments(filter?: DocumentListFilter): Promise<KnowledgeDocument[]>

/**
 * Read one document.
 * @param id - the document id.
 * @returns the document, or `undefined` when absent.
 */
async getDocument(id: string): Promise<KnowledgeDocument | undefined>

/**
 * Chunk and per-kind artifact counts of one document.
 * @param documentId - the document id.
 * @returns the chunk count and per-kind artifact counts.
 */
async artifactCounts(documentId: string): Promise<ArtifactCounts>

/**
 * Delete one document and its artifacts.
 * @param id - the document id.
 * @returns resolution once the deletion has landed.
 */
async deleteDocument(id: string): Promise<void>

/**
 * Read one template artifact.
 * @param artifactId - the artifact id.
 * @returns the artifact, or `undefined` when absent.
 */
async getTemplateArtifact(artifactId: string): Promise<TemplateArtifactRecord | undefined>

/**
 * List artifacts derived from one parent (its variants), oldest first.
 * @param parentId - the parent artifact id.
 * @returns the child artifacts oldest first.
 */
async listChildArtifacts(parentId: string): Promise<TemplateArtifactRecord[]>

/**
 * List every template artifact of one document, oldest first.
 * @param documentId - the owning document id.
 * @returns the document's artifacts oldest first.
 */
async listDocumentArtifacts(documentId: string): Promise<TemplateArtifactRecord[]>

/**
 * Generate and archive variants from one question template.
 * @param artifactId - the question_template artifact id.
 * @param request - optional count (defaults and caps from config) and target difficulty.
 * @returns the created variant artifact ids. the created variant artifact ids.
 */
async generateVariants( artifactId: string, request: { readonly count?: number; readonly difficulty?: Difficulty }, ): Promise<string[]>
```

Source: [`packages/workbench/knowledge/src/index.ts`](../../packages/workbench/knowledge/src/index.ts)

<a id="ctxknowledgeembedding--knowledgeembedding"></a>

### `ctx.knowledgeEmbedding` — `KnowledgeEmbedding`

Embedding seam; inputs and outputs are aligned by index.

```ts cordis-catalog
/**
 * Embed one or more texts in submission order.
 * @param texts - the texts to embed, batched internally by the provider.
 * @param signal - caller cancellation for the whole request set.
 * @returns one vector per input, aligned by index.
 * @throws when the endpoint fails or returns a misaligned response.
 */
embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
```

Source: [`packages/workbench/knowledge/src/types.ts`](../../packages/workbench/knowledge/src/types.ts)

<a id="ctxknowledgestore--knowledgestore"></a>

### `ctx.knowledgeStore` — `KnowledgeStore`

Durable storage seam for documents, chunks, and template artifacts.

```ts cordis-catalog
/**
 * Idempotently bootstrap the database, extension, schema, tables, and
 * indexes. Concurrency-safe; failures name the exact remediation.
 */
ensure(): Promise<void>

/**
 * Register one document. Re-registering an identical `sha256` resolves to
 * the existing record without changing its status.
 * @param input - the mode, names, MIME type, and content hash.
 * @returns the stored document (existing record on hash conflict).
 */
registerDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocument>

/**
 * Transition one document's status, replacing any prior error.
 * @param id - the document id.
 * @param status - the next lifecycle state.
 * @param error - the failure reason when transitioning to `failed`.
 * @throws when the document does not exist.
 */
setDocumentStatus(id: string, status: DocumentStatus, error?: string): Promise<void>

/**
 * Replace the stored chunk count of one document.
 * @param id - the document id.
 * @param chunkCount - the number of stored chunks.
 */
setChunkCount(id: string, chunkCount: number): Promise<void>

/**
 * Persist chunks for one document in one transaction.
 * @param documentId - the owning document id.
 * @param chunks - the ordered chunk drafts with embeddings.
 * @throws on any row failure; the transaction rolls back.
 */
insertChunks(documentId: string, chunks: readonly KnowledgeChunkInput[]): Promise<void>

/**
 * Persist one template artifact.
 * @param documentId - the owning document id.
 * @param artifact - the validated artifact with its embedding.
 * @returns the artifact id assigned by the store.
 */
insertTemplateArtifact(documentId: string, artifact: TemplateArtifactInput): Promise<string>

/**
 * Read one template artifact.
 * @param artifactId - the artifact id.
 * @returns the artifact, or `undefined` when absent.
 */
getTemplateArtifact(artifactId: string): Promise<TemplateArtifactRecord | undefined>

/**
 * List artifacts derived from one parent (its variants), oldest first.
 * @param parentId - the parent artifact id.
 * @returns the child artifacts oldest first.
 */
listChildArtifacts(parentId: string): Promise<TemplateArtifactRecord[]>

/**
 * List every template artifact of one document, oldest first.
 * @param documentId - the owning document id.
 * @returns the document's artifacts oldest first.
 */
listDocumentArtifacts(documentId: string): Promise<TemplateArtifactRecord[]>

/**
 * Delete every chunk and template artifact of one document.
 * @param documentId - the document id.
 */
clearDocumentArtifacts(documentId: string): Promise<void>

/**
 * Delete one document and, by cascade, its artifacts.
 * @param id - the document id.
 */
deleteDocument(id: string): Promise<void>

/**
 * List documents newest first, optionally filtered by mode.
 * @param filter - optional mode filter.
 * @returns the stored documents newest first.
 */
listDocuments(filter?: DocumentListFilter): Promise<KnowledgeDocument[]>

/**
 * Read one document.
 * @param id - the document id.
 * @returns the document, or `undefined` when absent.
 */
getDocument(id: string): Promise<KnowledgeDocument | undefined>

/**
 * Chunk and per-kind artifact counts of one document.
 * @param documentId - the document id.
 * @returns the chunk count and per-kind artifact counts.
 */
artifactCounts(documentId: string): Promise<ArtifactCounts>

/**
 * Mark every document stuck in a transient state as failed. Used at boot to
 * recover from process loss.
 * @param reason - the failure reason recorded on every transitioned document.
 * @returns the number of documents transitioned.
 */
failTransientDocuments(reason: string): Promise<number>

/**
 * Nearest-neighbour search across chunks and template artifacts.
 * @param request - the query embedding, structured filters, and `topK`.
 * @returns results ordered by descending similarity.
 */
search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]>

/**
 * Release the pool.
 * @returns resolution after the connections are closed; idempotent.
 */
close(): Promise<void>
```

Source: [`packages/workbench/knowledge/src/types.ts`](../../packages/workbench/knowledge/src/types.ts)
<!-- END GENERATED cordis-surface -->
