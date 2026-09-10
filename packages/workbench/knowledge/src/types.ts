/**
 * Shared contracts for the workbench knowledge capability: the document model,
 * the two provider seams (`KnowledgeStore`, `KnowledgeEmbedding`), and the
 * search vocabulary. Types only; runtime constants live in the owning modules.
 * @module @deepseek-ai/dsh-workbench-knowledge/types
 */

/** Ingest pipeline selected for one document at upload time. */
export type KnowledgeMode = 'knowledge' | 'template'

/** Durable lifecycle states of one ingesting document. */
export type DocumentStatus =
  | 'staged'
  | 'parsing'
  | 'chunking'
  | 'embedding'
  | 'generating'
  | 'ready'
  | 'failed'

/** The five fixed difficulty levels, ordered from easiest to hardest. */
export type Difficulty = 'easy' | 'normal' | 'hard' | 'hell' | 'nightmare'

/** Kinds of rows in the template artifact table. */
export type TemplateArtifactKind = 'document_template' | 'question' | 'question_template' | 'variant'

/** Searchable kinds: chunks plus every template artifact kind. */
export type SearchKind = 'chunk' | TemplateArtifactKind

/** LLM-distilled, retrieval-oriented metadata shared by template artifacts. */
export interface TemplateMetadata {
  /** Subject or discipline, e.g. `数学`. */
  subject: string
  /** Topic or chapter the content belongs to. */
  topic: string
  /** Dominant question type, e.g. `选择题` or `解答题`. */
  questionType: string
  /** Knowledge points the content examines. */
  knowledgePoints: string[]
  /** Retrieval keywords distilled from the document name and content. */
  keywords: string[]
  /** Grade level when the document name or content states one. */
  gradeLevel?: string
  /** Year when the document name or content states one. */
  year?: string
  /** Source provenance when the document name or content states one. */
  source?: string
}

/** One registered document. Timestamps are ISO-8601 strings. */
export interface KnowledgeDocument {
  readonly id: string
  readonly mode: KnowledgeMode
  readonly title: string
  readonly sourceName: string
  readonly mime: string
  readonly sha256: string
  readonly status: DocumentStatus
  readonly error?: string
  readonly chunkCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** New-document registration; the store owns id allocation on conflict. */
export interface KnowledgeDocumentInput {
  readonly mode: KnowledgeMode
  readonly title: string
  readonly sourceName: string
  readonly mime: string
  readonly sha256: string
}

/** One chunk to persist; the caller owns embedding and tokenization. */
export interface KnowledgeChunkInput {
  readonly seq: number
  readonly content: string
  readonly tokens: readonly string[]
  readonly embedding: readonly number[]
}

/** One template artifact to persist; payload is the caller-validated JSON. */
export interface TemplateArtifactInput {
  readonly kind: TemplateArtifactKind
  /** Id of the artifact this one derives from (question_template → question, variant → question_template). */
  readonly parentId?: string
  readonly title?: string
  readonly payload: unknown
  readonly difficulty?: Difficulty
  readonly metadata?: TemplateMetadata
  readonly embedding: readonly number[]
}

/** One stored template artifact, read back for display and variant generation. */
export interface TemplateArtifactRecord {
  readonly artifactId: string
  readonly documentId: string
  readonly kind: TemplateArtifactKind
  readonly parentId?: string
  readonly title?: string
  readonly payload: unknown
  readonly difficulty?: Difficulty
  readonly metadata?: TemplateMetadata
}

/** Filter for document listings. */
export interface DocumentListFilter {
  readonly mode?: KnowledgeMode
}

/** Filter for artifact counts of one document. */
export interface ArtifactCounts {
  readonly chunkCount: number
  readonly byKind: Readonly<Record<TemplateArtifactKind, number>>
}

/** Structured search request; the orchestration layer owns query embedding. */
export interface KnowledgeSearchRequest {
  readonly queryEmbedding: readonly number[]
  readonly kind?: SearchKind
  readonly mode?: KnowledgeMode
  readonly difficulty?: Difficulty
  readonly documentId?: string
  readonly topK: number
}

/** One search hit. `artifactId` is the template row id when present. */
export interface KnowledgeSearchResult {
  readonly kind: SearchKind
  /** Cosine similarity in [-1, 1]. */
  readonly score: number
  readonly documentId: string
  readonly documentTitle: string
  readonly mode: KnowledgeMode
  readonly seq?: number
  readonly artifactId?: string
  readonly parentId?: string
  readonly title?: string
  readonly content?: string
  readonly payload?: unknown
  readonly difficulty?: Difficulty
  readonly metadata?: TemplateMetadata
}

/** Durable storage seam for documents, chunks, and template artifacts. */
export interface KnowledgeStore {
  /** Vector dimension the store's columns and indexes are built for. */
  readonly dimensions: number

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
}

/** Embedding seam; inputs and outputs are aligned by index. */
export interface KnowledgeEmbedding {
  /** Vector dimension of every produced embedding. */
  readonly dimensions: number

  /**
   * Embed one or more texts in submission order.
   * @param texts - the texts to embed, batched internally by the provider.
   * @param signal - caller cancellation for the whole request set.
   * @returns one vector per input, aligned by index.
   * @throws when the endpoint fails or returns a misaligned response.
   */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>
}
