/**
 * OpenAI-compatible embeddings provider: posts batched `/embeddings` requests
 * to the configured base URL, enforces the configured dimension on every
 * returned vector, and registers the `knowledgeEmbedding` seam. Serves any
 * OpenAI-compatible endpoint (SiliconFlow, ARK, OpenAI) — only configuration
 * differs between them.
 * @module @deepseek-ai/dsh-workbench-knowledge-embedding-openai
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { KnowledgeEmbedding } from '@deepseek-ai/dsh-workbench-knowledge'

/** Cordis plugin name. */
export const name = 'workbench-knowledge-embedding-openai'
/** The provider owns its HTTP client and publishes the embedding seam. */
export const inject: readonly string[] = []

/** Plugin configuration. */
export interface Config {
  /** Base URL of the OpenAI-compatible API, e.g. `https://api.siliconflow.cn/v1`. */
  readonly baseUrl: string
  /** Embedding model id, e.g. `BAAI/bge-m3`. */
  readonly model: string
  /** Dimension of the produced vectors; must equal the store's dimension. */
  readonly dimensions: number
  /** Texts per HTTP request. @default 16 */
  readonly batchSize?: number
  /** Credential reference, currently `env:<NAME>` — the variable must exist in the harness process environment. */
  readonly credentialRef: string
  /** Per-request timeout in milliseconds. @default 60000 */
  readonly timeoutMs?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  model: z.string().required(),
  dimensions: z.number().step(1).min(2).max(20_000).required(),
  batchSize: z.number().step(1).min(1).max(256).default(16),
  credentialRef: z.string().required(),
  timeoutMs: z.number().step(1).min(1_000).max(600_000).default(60_000),
})

/** Resolved, ready-to-use provider configuration. */
export interface ResolvedEmbeddingConfig {
  readonly endpoint: string
  readonly model: string
  readonly dimensions: number
  readonly batchSize: number
  readonly apiKey: string
  readonly timeoutMs: number
}

/**
 * Resolve a `env:<NAME>` credential reference against the process environment.
 * @param credentialRef - the configured reference.
 * @returns the credential value.
 */
export function resolveCredential(credentialRef: string): string {
  const name = /^env:([A-Z_][A-Z0-9_]*)$/.exec(credentialRef)?.[1]
  if (name === undefined) {
    throw new Error(`workbench-knowledge-embedding-openai: credentialRef '${credentialRef}' must match env:<NAME>`)
  }
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(
      `workbench-knowledge-embedding-openai: environment variable ${name} is not set — add it to the dsh process environment and restart`,
    )
  }
  return value
}

/**
 * Build the resolved configuration; throws on a malformed base URL or credential.
 * @param config - the validated plugin configuration.
 * @returns the resolved, ready-to-use configuration.
 */
export function resolveConfig(config: Config): ResolvedEmbeddingConfig {
  let base: URL
  try {
    base = new URL(config.baseUrl)
  } catch {
    throw new Error(`workbench-knowledge-embedding-openai: baseUrl '${config.baseUrl}' is not a valid URL`)
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error(`workbench-knowledge-embedding-openai: baseUrl '${config.baseUrl}' must use http(s)`)
  }
  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`
  return {
    endpoint,
    model: config.model,
    dimensions: config.dimensions,
    batchSize: config.batchSize ?? 16,
    apiKey: resolveCredential(config.credentialRef),
    timeoutMs: config.timeoutMs ?? 60_000,
  }
}

interface EmbeddingsResponse {
  readonly data?: readonly { readonly index?: number; readonly embedding?: readonly number[] }[]
}

/**
 * The OpenAI-compatible {@link KnowledgeEmbedding}. Batched sequential
 * requests keep provider rate limits honest; one immediate retry covers a
 * transient network failure or 5xx response.
 */
export class OpenAiCompatibleEmbedding implements KnowledgeEmbedding {
  readonly dimensions: number

  constructor(private readonly config: ResolvedEmbeddingConfig) {
    this.dimensions = config.dimensions
  }

  /** @inheritdoc */
  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const results = new Array<number[]>(texts.length)
    for (let start = 0; start < texts.length; start += this.config.batchSize) {
      const batch = texts.slice(start, start + this.config.batchSize)
      const vectors = await this.embedBatch(batch, signal)
      for (let offset = 0; offset < vectors.length; offset += 1) {
        const vector = vectors[offset]
        if (vector === undefined) {
          throw new Error('workbench-knowledge-embedding-openai: endpoint returned fewer embeddings than inputs')
        }
        results[start + offset] = vector
      }
    }
    return results
  }

  private async embedBatch(batch: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    try {
      return await this.post(batch, signal)
    } catch (first) {
      if (signal?.aborted === true) throw first
      if (!isTransient(first)) throw first
      return this.post(batch, signal)
    }
  }

  private async post(batch: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, input: [...batch] }),
      signal: signal === undefined
        ? AbortSignal.timeout(this.config.timeoutMs)
        : AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`workbench-knowledge-embedding-openai: endpoint returned ${response.status}: ${text.slice(0, 200)}`)
    }
    let parsed: EmbeddingsResponse
    try {
      parsed = JSON.parse(text) as EmbeddingsResponse
    } catch {
      throw new Error('workbench-knowledge-embedding-openai: endpoint returned a non-JSON body')
    }
    const data = parsed.data
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error(`workbench-knowledge-embedding-openai: endpoint returned ${data?.length ?? 0} embeddings for ${batch.length} inputs`)
    }
    return data.map((entry, index) => {
      const vector = entry.embedding
      if (!Array.isArray(vector) || vector.length !== this.config.dimensions) {
        throw new Error(
          `workbench-knowledge-embedding-openai: embedding at index ${index} has ${vector?.length ?? 0} dimensions, expected ${this.config.dimensions}`,
        )
      }
      for (const value of vector) {
        if (!Number.isFinite(value)) {
          throw new Error(`workbench-knowledge-embedding-openai: embedding at index ${index} contains a non-finite value`)
        }
      }
      return [...vector]
    })
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof Error && error.name === 'TypeError') return true
  const status = (error as { message?: string }).message ?? ''
  return /\b5\d\d\b/.test(status)
}

/**
 * Resolve configuration and publish the provider as `knowledgeEmbedding`.
 * A malformed URL or a missing credential fails the mount loudly.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('knowledgeEmbedding', new OpenAiCompatibleEmbedding(resolveConfig(config)))
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The embedding provider seam. */
    knowledgeEmbedding: KnowledgeEmbedding
  }
}
