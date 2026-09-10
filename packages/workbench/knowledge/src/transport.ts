/**
 * Transport: authenticated exact Fetch routes over the shared `/api` channel.
 * Destructive and generation actions are POST bodies because the route method
 * union is `GET|HEAD|POST`; document upload aggregates a streaming body under
 * the configured size cap. Request and response JSON is validated at this
 * boundary.
 * @module @deepseek-ai/dsh-workbench-knowledge/transport
 */

import { createHash } from 'node:crypto'
import type { Difficulty, KnowledgeDocument, KnowledgeMode, KnowledgeSearchResult, TemplateArtifactRecord } from './types.ts'
import { DIFFICULTIES } from './difficulties.ts'
import type { KnowledgeService } from './index.ts'

/** Connection Fetch-registry shape this package consumes. */
export interface KnowledgeConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

/** Transport bounds shared with the upload route. */
export interface TransportConfig {
  readonly maxFileBytes: number
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function jsonError(status: number, message: string): Response {
  return json({ error: message }, status)
}

async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('request body is not valid JSON')
  }
}

function searchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams
}

function fail(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error)
  return jsonError(400, message)
}

function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value)
}

function isMode(value: unknown): value is KnowledgeMode {
  return value === 'knowledge' || value === 'template'
}

interface DocumentWithCounts {
  readonly document: KnowledgeDocument
  readonly counts: {
    readonly chunkCount: number
    readonly byKind: Record<string, number>
  }
}

/**
 * Register every knowledge route.
 * @param connection - the host connection Fetch registry.
 * @param service - the orchestration service.
 * @param config - transport bounds.
 * @returns the combined asynchronous disposer.
 */
export function registerKnowledgeRoutes(
  connection: KnowledgeConnection,
  service: KnowledgeService,
  config: TransportConfig,
): () => Promise<void> {
  const disposers = [
    connection.fetch.register({
      path: '/api/knowledge.documents.upload',
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: async (request) => {
        try {
          const params = searchParams(request)
          const mode = params.get('mode')
          const name = params.get('name') ?? 'document'
          const title = params.get('title') ?? undefined
          if (!isMode(mode)) return jsonError(400, 'query parameter mode must be knowledge or template')
          // An over-cap body must be DRAINED before responding: returning
          // early leaves the streaming request unread, and the HTTP bridge
          // then destroys the socket (requestUnread), which the browser XHR
          // surfaces as a generic network error instead of the 413 reason.
          const parts: Uint8Array[] = []
          let total = 0
          let overLimit = false
          for await (const chunk of request.body ?? []) {
            const bytes = chunk as Uint8Array
            total += bytes.byteLength
            if (total > config.maxFileBytes) overLimit = true
            else parts.push(bytes)
          }
          if (overLimit) return jsonError(413, `upload exceeds maxFileBytes ${config.maxFileBytes}`)
          const merged = new Uint8Array(total)
          let offset = 0
          for (const part of parts) {
            merged.set(part, offset)
            offset += part.byteLength
          }
          if (total === 0) return jsonError(400, 'upload body is empty')
          const document = await service.submitDocument({
            mode,
            sourceName: name,
            mime: request.headers.get('content-type') ?? 'application/octet-stream',
            sha256: createHash('sha256').update(merged).digest('hex'),
            data: merged,
            ...(title === undefined ? {} : { title }),
            signal: request.signal,
          })
          return json({ document })
        } catch (error) {
          return fail(error)
        }
      },
    }),

    connection.fetch.register({
      path: '/api/knowledge.documents',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const mode = searchParams(request).get('mode')
          if (mode !== null && !isMode(mode)) return jsonError(400, 'query parameter mode must be knowledge or template')
          const documents = await service.listDocuments(mode === null ? undefined : { mode })
          const withCounts = await Promise.all(documents.map(async (document): Promise<DocumentWithCounts> => {
            const counts = await service.artifactCounts(document.id)
            return { document, counts: { chunkCount: counts.chunkCount, byKind: { ...counts.byKind } } }
          }))
          return json({ documents: withCounts })
        } catch (error) {
          return fail(error)
        }
      },
    }),

    connection.fetch.register({
      path: '/api/knowledge.documents.delete',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readJson<{ id?: unknown }>(request)
          if (typeof body.id !== 'string') return jsonError(400, 'field id must be a string')
          await service.deleteDocument(body.id)
          return json({ ok: true })
        } catch (error) {
          return fail(error)
        }
      },
    }),

    connection.fetch.register({
      path: '/api/knowledge.documents.reingest',
      methods: ['POST'],
      requestBody: 'streaming',
      fetch: async (request) => {
        try {
          const id = searchParams(request).get('id')
          if (id === null || id.length === 0) return jsonError(400, 'query parameter id is required')
          // Same drain rule as the upload route: an over-cap body must be
          // consumed before responding, or the bridge destroys the socket
          // and the browser reports a network error instead of the reason.
          const parts: Uint8Array[] = []
          let total = 0
          let overLimit = false
          for await (const chunk of request.body ?? []) {
            const bytes = chunk as Uint8Array
            total += bytes.byteLength
            if (total > config.maxFileBytes) overLimit = true
            else parts.push(bytes)
          }
          if (overLimit) return jsonError(413, `upload exceeds maxFileBytes ${config.maxFileBytes}`)
          const merged = new Uint8Array(total)
          let offset = 0
          for (const part of parts) {
            merged.set(part, offset)
            offset += part.byteLength
          }
          const document = await service.reingestDocument(id, merged, request.signal)
          return json({ document })
        } catch (error) {
          return fail(error)
        }
      },
    }),

    connection.fetch.register({
      path: '/api/knowledge.search',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readJson<{
            query?: unknown
            kind?: unknown
            mode?: unknown
            difficulty?: unknown
            documentId?: unknown
            topK?: unknown
          }>(request)
          if (typeof body.query !== 'string' || body.query.trim().length === 0) {
            return jsonError(400, 'field query must be a non-empty string')
          }
          if (body.kind !== undefined && body.kind !== 'chunk'
            && !['document_template', 'question', 'question_template', 'variant'].includes(body.kind as string)) {
            return jsonError(400, 'field kind is not a searchable kind')
          }
          if (body.mode !== undefined && !isMode(body.mode)) return jsonError(400, 'field mode must be knowledge or template')
          if (body.difficulty !== undefined && !isDifficulty(body.difficulty)) {
            return jsonError(400, `field difficulty must be one of ${DIFFICULTIES.join('|')}`)
          }
          const results: KnowledgeSearchResult[] = await service.search({
            query: body.query,
            ...(body.kind === undefined ? {} : { kind: body.kind as KnowledgeSearchResult['kind'] }),
            ...(body.mode === undefined ? {} : { mode: body.mode }),
            ...(body.difficulty === undefined ? {} : { difficulty: body.difficulty }),
            ...(body.documentId === undefined || typeof body.documentId !== 'string'
              ? {} : { documentId: body.documentId }),
            ...(typeof body.topK === 'number' ? { topK: body.topK } : {}),
          })
          return json({ results })
        } catch (error) {
          return fail(error)
        }
      },
    }),

    connection.fetch.register({
      path: '/api/knowledge.templates.generate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await readJson<{ artifactId?: unknown; count?: unknown; difficulty?: unknown }>(request)
          if (typeof body.artifactId !== 'string') return jsonError(400, 'field artifactId must be a string')
          if (body.difficulty !== undefined && !isDifficulty(body.difficulty)) {
            return jsonError(400, `field difficulty must be one of ${DIFFICULTIES.join('|')}`)
          }
          const ids = await service.generateVariants(body.artifactId, {
            ...(typeof body.count === 'number' ? { count: body.count } : {}),
            ...(body.difficulty === undefined ? {} : { difficulty: body.difficulty }),
          })
          return json({ ids })
        } catch (error) {
          return fail(error)
        }
      },
    }),

    connection.fetch.register({
      path: '/api/knowledge.artifacts',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const params = searchParams(request)
          const documentId = params.get('documentId')
          const parentId = params.get('parentId')
          if (documentId !== null) {
            const artifacts: TemplateArtifactRecord[] = await service.listDocumentArtifacts(documentId)
            return json({ artifacts })
          }
          if (parentId !== null) {
            const artifacts: TemplateArtifactRecord[] = await service.listChildArtifacts(parentId)
            return json({ artifacts })
          }
          return jsonError(400, 'query parameter documentId or parentId is required')
        } catch (error) {
          return fail(error)
        }
      },
    }),
  ]
  return () => Promise.all(disposers.map(dispose => dispose())).then(() => {})
}
