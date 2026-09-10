/**
 * The ingest orchestrator: runs one document through its selected pipeline
 * with durable state transitions, embedding, and per-artifact persistence.
 * Every failure lands the document in the `failed` state with the cause; the
 * caller never observes a thrown pipeline error.
 * @module @deepseek-ai/dsh-workbench-knowledge/ingest
 */

import { chunkParsedDocument } from './chunk.ts'
import { parseDocument, ParseError } from './parse/index.ts'
import { runTemplatePipeline, type TemplatePipelineConfig, type TemplatePipelineDeps } from './template-pipeline.ts'
import { tokenize } from './tokenize.ts'
import type { KnowledgeEmbedding, KnowledgeMode, KnowledgeStore } from './types.ts'

/** Token cap stored with each chunk. */
export const CHUNK_TOKEN_CAP = 256

/** Resolved bounds the orchestrator consumes. */
export interface IngestConfig {
  readonly chunking: { readonly targetChars: number; readonly maxChars: number; readonly overlapChars: number }
  readonly template: TemplatePipelineConfig
}

/** Ingest inputs for one staged document. */
export interface IngestRequest {
  readonly documentId: string
  readonly mode: KnowledgeMode
  readonly title: string
  readonly sourceName: string
  readonly mime: string
  readonly data: Uint8Array
  readonly signal?: AbortSignal
}

/**
 * Run ingestions sequentially; each document owns its pipeline, and the
 * orchestrator serializes across documents so a burst of uploads cannot fan
 * out unbounded model or embedding calls.
 */
export class KnowledgeIngestor {
  private readonly queue: Array<() => Promise<void>> = []
  private draining = false

  constructor(
    private readonly store: KnowledgeStore,
    private readonly embedding: KnowledgeEmbedding,
    private readonly config: IngestConfig,
    private readonly templateDeps: Omit<TemplatePipelineDeps, 'store'>,
  ) {}

  /**
   * Enqueue one document's pipeline. Resolves when the document is queued,
   * not when its pipeline finishes; progress is observable through the store.
   * @param request - the staged document's identity, bytes, and mode.
   */
  enqueue(request: IngestRequest): void {
    this.queue.push(() => this.run(request))
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()
        if (next === undefined) continue
        await next()
      }
    } finally {
      this.draining = false
    }
  }

  private async run(request: IngestRequest): Promise<void> {
    try {
      if (request.mode === 'knowledge') await this.ingestKnowledge(request)
      else await this.ingestTemplate(request)
    } catch (error) {
      const message = error instanceof ParseError
        ? `${error.code}: ${error.message}`
        : error instanceof Error ? error.message : String(error)
      await this.store.setDocumentStatus(request.documentId, 'failed', message).catch(() => {
        // The store itself is broken; the failure is already surfaced by the
        // store's own callers.
      })
    }
  }

  private async ingestKnowledge(request: IngestRequest): Promise<void> {
    const { store, embedding } = this
    await store.setDocumentStatus(request.documentId, 'parsing')
    request.signal?.throwIfAborted()
    const parsed = await parseDocument(request.sourceName, request.mime, request.data, request.signal)
    if (parsed.blocks.length === 0) {
      throw new ParseError('empty-document', 'the document contains no extractable text')
    }
    await store.setDocumentStatus(request.documentId, 'chunking')
    const drafts = chunkParsedDocument(parsed, this.config.chunking)
    await store.setDocumentStatus(request.documentId, 'embedding')
    const contents = drafts.map(draft => draft.content)
    const embeddings = await embedding.embed(contents, request.signal)
    await store.insertChunks(request.documentId, drafts.map((draft, index) => {
      const embeddingRow = embeddings[index]
      if (embeddingRow === undefined) {
        throw new Error(`workbench-knowledge: the embedding endpoint returned fewer rows than inputs (row ${index})`)
      }
      return {
        seq: index,
        content: draft.content,
        tokens: tokenize(draft.content, CHUNK_TOKEN_CAP),
        embedding: embeddingRow,
      }
    }))
    await store.setChunkCount(request.documentId, drafts.length)
    await store.setDocumentStatus(request.documentId, 'ready')
  }

  private async ingestTemplate(request: IngestRequest): Promise<void> {
    const { store } = this
    await store.setDocumentStatus(request.documentId, 'parsing')
    request.signal?.throwIfAborted()
    const parsed = await parseDocument(request.sourceName, request.mime, request.data, request.signal)
    if (parsed.blocks.length === 0) {
      throw new ParseError('empty-document', 'the document contains no extractable text')
    }
    await store.setDocumentStatus(request.documentId, 'generating')
    await runTemplatePipeline(
      { ...this.templateDeps, store },
      this.config.template,
      {
        documentId: request.documentId,
        title: request.title,
        blocks: parsed.blocks,
      },
      request.signal,
    )
    await store.setDocumentStatus(request.documentId, 'ready')
  }
}

/**
 * Default document title for uploads without a parseable title.
 * @param sourceName - the uploaded file name.
 * @param parsedTitle - the title the parser extracted, when any.
 * @returns the parsed title or the source name without its extension.
 */
export function documentTitle(sourceName: string, parsedTitle: string | undefined): string {
  return parsedTitle ?? sourceName.replace(/\.[^.]+$/, '')
}
