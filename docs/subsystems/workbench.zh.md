# Workbench 子系统

[English](workbench.md) | 中文

workbench 子系统把上传文档变成存于 PostgreSQL + pgvector 的个人知识库，并呈现在 Web 设置页中。

## 文档与模式

上传时必须明确选择一种模式。`knowledge` 模式解析文档（Markdown、纯文本、PDF 文字层、DOCX 标题样式、HTML），按标题感知边界与配置的重叠切分，`Intl.Segmenter` 分词，向量化后入库为片段。`template` 模式解析文档，提炼文档级元数据（学科、主题、题型、考点、关键词为必提炼；年级、年份、来源在文档名或内容提到时给出），生成一份文档级出题模板，按有界窗口抽取已有题目，并为每道题生成一份变式模板。每份文档携带持久状态（`staged → parsing → chunking → embedding → generating → ready | failed`）；重启时处于瞬态的文档标记为 `failed`，原因为 `interrupted by restart`。

## 难度与元数据

难度是封闭的五档枚举——`easy`、`normal`、`hard`、`hell`、`nightmare`——在 JSON 边界校验，作为模板产物的结构化带索引列存储；本地化标签只存在于浏览器词典。元数据按文档提炼一次、由其产物共享、逐题精修，并进入每个产物的向量文本，因此按文档名、学科、主题、关键词都能搜到。

## 数据模型

`kb_documents`（标识、模式、状态、sha256 去重）、`kb_chunks`（seq、内容、tokens、embedding）、`kb_templates`（kind `document_template | question | question_template | variant`、`parent_id` 派生链、payload、难度、metadata、embedding）。两个 embedding 列各建 HNSW `vector_cosine_ops` 索引；schema 版本单调记录并与维度一并存放。

## 检索与生成

检索对查询文本 embedding 后，在片段与产物上运行余弦最近邻，支持结构化过滤（kind、模式、难度、文档），合并按得分排序的结果。变式生成填充模板的 `generationPrompt`——其 `{difficulty}` 占位符取请求难度或模板自身难度——并把每道生成的变式题归档在其模板之下，继承元数据并携带所评难度。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
