/**
 * Personal knowledge workbench orchestration: declares the store and embedding
 * seams, owns ingest pipelines, query embedding, search orchestration, and
 * variant generation, and publishes the `ctx.knowledge` service. The pgvector
 * and embedding providers register the two seams this service consumes.
 * @module @deepseek-ai/dsh-workbench-knowledge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { KnowledgeIngestor, type IngestConfig, type IngestRequest } from './ingest.ts'
import { createLlmCaller } from './llm.ts'
import { generateVariants } from './template-pipeline.ts'
import { registerKnowledgeRoutes, type KnowledgeConnection } from './transport.ts'
import type {
  ArtifactCounts,
  Difficulty,
  DocumentListFilter,
  KnowledgeDocument,
  KnowledgeEmbedding,
  KnowledgeSearchResult,
  KnowledgeStore,
  TemplateArtifactRecord,
} from './types.ts'
export type {
  ArtifactCounts,
  Difficulty,
  DocumentListFilter,
  KnowledgeChunkInput,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeEmbedding,
  KnowledgeMode,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  KnowledgeStore,
  DocumentStatus,
  SearchKind,
  TemplateArtifactInput,
  TemplateArtifactKind,
  TemplateArtifactRecord,
  TemplateMetadata,
} from './types.ts'
export { KnowledgeIngestor, documentTitle, CHUNK_TOKEN_CAP, type IngestConfig, type IngestRequest } from './ingest.ts'
export { createLlmCaller, extractJson, type KnowledgeLlmRoute, type LlmCaller } from './llm.ts'
export {
  runTemplatePipeline,
  generateVariants,
  validateMetadata,
  validateQuestion,
  validateVariantTemplate,
  type ExtractedQuestion,
  type QuestionVariantTemplate,
  type TemplatePipelineConfig,
  type TemplatePipelineSummary,
} from './template-pipeline.ts'
export { chunkParsedDocument, type ChunkDraft, type ChunkingOptions } from './chunk.ts'
export { tokenize } from './tokenize.ts'
export { DIFFICULTIES } from './difficulties.ts'
export { registerKnowledgeRoutes, type KnowledgeConnection, type TransportConfig } from './transport.ts'

/** Cordis plugin name. */
export const name = 'workbench-knowledge'
/** The orchestration service waits for both providers, the model route, and the web transport. */
export const inject = ['knowledgeStore', 'knowledgeEmbedding', 'llm', 'connection']

/** Sizing defaults for chunking. */
export const CHUNKING_DEFAULTS = { targetChars: 700, maxChars: 1200, overlapChars: 120 } as const

/** Sizing defaults for the template pipeline. */
export const TEMPLATE_DEFAULTS = {
  maxDocumentChars: 60_000,
  maxQuestions: 50,
  extractionWindowChars: 12_000,
  questionTemplateConcurrency: 2,
} as const

/** Defaults for variant generation. */
export const GENERATION_DEFAULTS = { defaultVariantCount: 3, maxVariantCount: 10 } as const

/** Defaults for upload admission. The 100 MiB ceiling is sized for large exam documents; `uploads.maxFileBytes` overrides it. */
export const UPLOAD_DEFAULTS = { stagingDir: 'workbench/uploads', maxFileBytes: 104_857_600 } as const

/** Defaults for search fan-out. */
export const SEARCH_DEFAULTS = { defaultTopK: 8, maxTopK: 50 } as const

/** Plugin configuration. */
export interface Config {
  /** Storage backend this composition expects. The matching provider row must register `knowledgeStore`. */
  readonly store: {
    /** The registered store backend name. */
    readonly backend: 'pgvector'
  }
  /** Embedding provider this composition expects. The matching provider row must register `knowledgeEmbedding`. */
  readonly embedding: {
    /** The registered embedding provider name. */
    readonly provider: 'openai-compatible'
  }
  /** The model route every template-pipeline call runs on; there is no deployment-wide default route service. */
  readonly template: {
    /** The provider/model route of the template pipeline's model. */
    readonly llm: {
      /** Provider route id, e.g. `deepseek-official`. */
      readonly provider: string
      /** Model id served by that provider route. */
      readonly model: string
    }
    /** Longest document text fed to one template call, in characters. */
    readonly maxDocumentChars?: number
    /** Most questions extracted per document. */
    readonly maxQuestions?: number
    /** Question-extraction sliding-window size, in characters. */
    readonly extractionWindowChars?: number
    /** Parallel per-question variant-template model calls. */
    readonly questionTemplateConcurrency?: number
  }
  /** Chunk sizing bounds. */
  readonly chunking?: {
    /** Sections merge up to this size, in characters. */
    readonly targetChars?: number
    /** Hard per-chunk upper bound, in characters. */
    readonly maxChars?: number
    /** Characters of the previous split carried into the next chunk. */
    readonly overlapChars?: number
  }
  /** Variant generation defaults and caps. */
  readonly generation?: {
    /** Variants generated when a request omits a count. */
    readonly defaultVariantCount?: number
    /** Upper bound accepted for one generation request. */
    readonly maxVariantCount?: number
  }
  /** Upload admission bounds. */
  readonly uploads?: {
    /** Reserved staging directory name below the harness home. */
    readonly stagingDir?: string
    /** Largest accepted upload, in bytes. */
    readonly maxFileBytes?: number
  }
  /** Search result bounds. */
  readonly search?: {
    /** Results returned when a request omits `topK`. */
    readonly defaultTopK?: number
    /** Upper bound accepted for `topK`. */
    readonly maxTopK?: number
  }
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  store: z.object({ backend: z.union(['pgvector'] as const).required() }).required(),
  embedding: z.object({ provider: z.union(['openai-compatible'] as const).required() }).required(),
  template: z.object({
    llm: z.object({
      provider: z.string().required(),
      model: z.string().required(),
    }).required(),
    maxDocumentChars: z.number().min(1_000).max(1_000_000).default(TEMPLATE_DEFAULTS.maxDocumentChars),
    maxQuestions: z.number().min(1).max(500).default(TEMPLATE_DEFAULTS.maxQuestions),
    extractionWindowChars: z.number().min(1_000).max(100_000).default(TEMPLATE_DEFAULTS.extractionWindowChars),
    questionTemplateConcurrency: z.number().min(1).max(16).default(TEMPLATE_DEFAULTS.questionTemplateConcurrency),
  }).required(),
  chunking: z.object({
    targetChars: z.number().min(100).max(4_000).default(CHUNKING_DEFAULTS.targetChars),
    maxChars: z.number().min(200).max(8_000).default(CHUNKING_DEFAULTS.maxChars),
    overlapChars: z.number().min(0).max(1_000).default(CHUNKING_DEFAULTS.overlapChars),
  }),
  generation: z.object({
    defaultVariantCount: z.number().min(1).max(50).default(GENERATION_DEFAULTS.defaultVariantCount),
    maxVariantCount: z.number().min(1).max(50).default(GENERATION_DEFAULTS.maxVariantCount),
  }),
  uploads: z.object({
    stagingDir: z.string().default(UPLOAD_DEFAULTS.stagingDir),
    maxFileBytes: z.number().min(1_024).max(1_073_741_824).default(UPLOAD_DEFAULTS.maxFileBytes),
  }),
  search: z.object({
    defaultTopK: z.number().min(1).max(100).default(SEARCH_DEFAULTS.defaultTopK),
    maxTopK: z.number().min(1).max(100).default(SEARCH_DEFAULTS.maxTopK),
  }),
})

type ResolvedConfig = {
  readonly store: Config['store']
  readonly embedding: Config['embedding']
  readonly template: Required<Config['template']>
  readonly chunking: Required<NonNullable<Config['chunking']>>
  readonly generation: Required<NonNullable<Config['generation']>>
  readonly uploads: Required<NonNullable<Config['uploads']>>
  readonly search: Required<NonNullable<Config['search']>>
}

/** The fully-resolved orchestration configuration (exported for tests). */
export type ResolvedKnowledgeConfig = ResolvedConfig

/** Caller-facing search input; `query` is plain text, embedding happens here. */
export interface KnowledgeSearchInput {
  readonly query: string
  readonly kind?: KnowledgeSearchResult['kind']
  readonly mode?: KnowledgeDocument['mode']
  readonly difficulty?: Difficulty
  readonly documentId?: string
  readonly topK?: number
}

/** Upload submission; the ingest decision is the service's. */
export interface SubmitDocumentInput {
  readonly mode: KnowledgeDocument['mode']
  readonly sourceName: string
  readonly mime: string
  readonly sha256: string
  readonly data: Uint8Array
  readonly title?: string
  readonly signal?: AbortSignal
}

/**
 * Orchestration over the store and embedding seams. Every public method first
 * awaits `ready()`, which bootstraps the store, recovers interrupted
 * documents, and fails loudly on a dimension mismatch between the configured
 * providers.
 */
export class KnowledgeService {
  private readonly ingestor: KnowledgeIngestor
  private readonly caller: ReturnType<typeof createLlmCaller>
  private readyPromise: Promise<void> | undefined

  constructor(
    private readonly store: KnowledgeStore,
    private readonly embedding: KnowledgeEmbedding,
    llm: Parameters<typeof createLlmCaller>[0],
    private readonly config: ResolvedConfig,
  ) {
    this.caller = createLlmCaller(llm, config.template.llm)
    this.ingestor = new KnowledgeIngestor(store, embedding, this.ingestConfig(), {
      caller: this.caller,
      embedding,
    })
  }

  private ingestConfig(): IngestConfig {
    return {
      chunking: this.config.chunking,
      template: {
        maxDocumentChars: this.config.template.maxDocumentChars,
        maxQuestions: this.config.template.maxQuestions,
        extractionWindowChars: this.config.template.extractionWindowChars,
        questionTemplateConcurrency: this.config.template.questionTemplateConcurrency,
      },
    }
  }

  /**
   * Resolve once the store is bootstrapped, interrupted documents are
   * recovered, and the two seam dimensions agree.
   * @returns resolution when the capability is usable.
   */
  ready(): Promise<void> {
    this.readyPromise ??= this.initialize()
    return this.readyPromise
  }

  private async initialize(): Promise<void> {
    await this.store.ensure()
    if (this.store.dimensions !== this.embedding.dimensions) {
      throw new Error(
        `workbench-knowledge: store dimensions ${this.store.dimensions} do not match embedding dimensions ${this.embedding.dimensions}`,
      )
    }
    await this.store.failTransientDocuments('interrupted by restart')
  }

  /**
   * Register and enqueue one document. A repeated upload resolves to the
   * existing record without re-running the pipeline.
   * @param input - the mode, names, content hash, and bytes of the upload.
   * @returns the stored document.
   */
  async submitDocument(input: SubmitDocumentInput): Promise<KnowledgeDocument> {
    await this.ready()
    const document = await this.store.registerDocument({
      mode: input.mode,
      title: input.title ?? input.sourceName.replace(/\.[^.]+$/, ''),
      sourceName: input.sourceName,
      mime: input.mime,
      sha256: input.sha256,
    })
    if (document.status === 'staged' || document.status === 'failed') {
      const request: IngestRequest = {
        documentId: document.id,
        mode: document.mode,
        title: document.title,
        sourceName: input.sourceName,
        mime: input.mime,
        data: input.data,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }
      this.ingestor.enqueue(request)
    }
    return document
  }

  /**
   * Re-run one document's pipeline: artifacts are cleared first.
   * @param id - the document id.
   * @param data - the document bytes, supplied again by the client.
   * @param signal - cancellation for the queued pipeline.
   * @returns the document restaged for ingest.
   * @throws when the document does not exist.
   */
  async reingestDocument(id: string, data: Uint8Array, signal?: AbortSignal): Promise<KnowledgeDocument> {
    await this.ready()
    const document = await this.store.getDocument(id)
    if (document === undefined) throw new Error(`workbench-knowledge: document ${id} does not exist`)
    await this.store.clearDocumentArtifacts(id)
    await this.store.setDocumentStatus(id, 'staged')
    const request: IngestRequest = {
      documentId: document.id,
      mode: document.mode,
      title: document.title,
      sourceName: document.sourceName,
      mime: document.mime,
      data,
      ...(signal === undefined ? {} : { signal }),
    }
    this.ingestor.enqueue(request)
    return { ...document, status: 'staged' }
  }

  /**
   * Embed the query and run the nearest-neighbour search across the store.
   * @param input - query text with optional structured filters.
   * @returns results ordered by descending similarity.
   */
  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult[]> {
    await this.ready()
    const topK = Math.min(input.topK ?? this.config.search.defaultTopK, this.config.search.maxTopK)
    const [queryEmbedding] = await this.embedding.embed([input.query])
    if (queryEmbedding === undefined) {
      throw new Error('workbench-knowledge: the embedding endpoint returned no vector for the query')
    }
    return this.store.search({
      queryEmbedding,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      ...(input.difficulty === undefined ? {} : { difficulty: input.difficulty }),
      ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
      topK,
    })
  }

  /**
   * List documents newest first, optionally filtered by mode.
   * @param filter - optional mode filter.
   * @returns the stored documents newest first.
   */
  async listDocuments(filter?: DocumentListFilter): Promise<KnowledgeDocument[]> {
    await this.ready()
    return this.store.listDocuments(filter)
  }

  /**
   * Read one document.
   * @param id - the document id.
   * @returns the document, or `undefined` when absent.
   */
  async getDocument(id: string): Promise<KnowledgeDocument | undefined> {
    await this.ready()
    return this.store.getDocument(id)
  }

  /**
   * Chunk and per-kind artifact counts of one document.
   * @param documentId - the document id.
   * @returns the chunk count and per-kind artifact counts.
   */
  async artifactCounts(documentId: string): Promise<ArtifactCounts> {
    await this.ready()
    return this.store.artifactCounts(documentId)
  }

  /**
   * Delete one document and its artifacts.
   * @param id - the document id.
   * @returns resolution once the deletion has landed.
   */
  async deleteDocument(id: string): Promise<void> {
    await this.ready()
    return this.store.deleteDocument(id)
  }

  /**
   * Read one template artifact.
   * @param artifactId - the artifact id.
   * @returns the artifact, or `undefined` when absent.
   */
  async getTemplateArtifact(artifactId: string): Promise<TemplateArtifactRecord | undefined> {
    await this.ready()
    return this.store.getTemplateArtifact(artifactId)
  }

  /**
   * List artifacts derived from one parent (its variants), oldest first.
   * @param parentId - the parent artifact id.
   * @returns the child artifacts oldest first.
   */
  async listChildArtifacts(parentId: string): Promise<TemplateArtifactRecord[]> {
    await this.ready()
    return this.store.listChildArtifacts(parentId)
  }

  /**
   * List every template artifact of one document, oldest first.
   * @param documentId - the owning document id.
   * @returns the document's artifacts oldest first.
   */
  async listDocumentArtifacts(documentId: string): Promise<TemplateArtifactRecord[]> {
    await this.ready()
    return this.store.listDocumentArtifacts(documentId)
  }

  /**
   * Generate and archive variants from one question template.
   * @param artifactId - the question_template artifact id.
   * @param request - optional count (defaults and caps from config) and target difficulty.
   * @returns the created variant artifact ids. the created variant artifact ids.
   */
  async generateVariants(
    artifactId: string,
    request: { readonly count?: number; readonly difficulty?: Difficulty },
  ): Promise<string[]> {
    await this.ready()
    const template = await this.store.getTemplateArtifact(artifactId)
    if (template === undefined) throw new Error(`workbench-knowledge: artifact ${artifactId} does not exist`)
    if (template.kind !== 'question_template') {
      throw new Error(`workbench-knowledge: artifact ${artifactId} is a ${template.kind}, not a question_template`)
    }
    const count = Math.min(request.count ?? this.config.generation.defaultVariantCount, this.config.generation.maxVariantCount)
    return generateVariants(
      { caller: this.caller, embedding: this.embedding, store: this.store },
      template,
      {
        count,
        ...(request.difficulty === undefined ? {} : { difficulty: request.difficulty }),
      },
    )
  }
}

/**
 * Publish `ctx.knowledge` and wait for the store bootstrap once at activation
 * so a broken store or a dimension mismatch fails the mount loudly.
 * @param ctx - host context carrying both provider services and the model route.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const service = new KnowledgeService(
    ctx.knowledgeStore,
    ctx.knowledgeEmbedding,
    ctx.llm,
    config as ResolvedConfig,
  )
  ctx.provide('knowledge', service)
  await service.ready()
  const connection = ctx.get('connection') as KnowledgeConnection
  ctx.effect(
    () => registerKnowledgeRoutes(
      connection,
      service,
      { maxFileBytes: (config as ResolvedConfig).uploads.maxFileBytes },
    ),
    'workbench-knowledge: fetch routes',
  )
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The workbench knowledge orchestration service. */
    knowledge: KnowledgeService
    /** The durable knowledge store provider seam. */
    knowledgeStore: KnowledgeStore
    /** The embedding provider seam. */
    knowledgeEmbedding: KnowledgeEmbedding
  }
}
