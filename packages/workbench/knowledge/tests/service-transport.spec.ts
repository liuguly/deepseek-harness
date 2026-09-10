import { describe, expect, it, vi } from 'vitest'
import { KnowledgeService } from '../src/index.ts'
import type { ResolvedKnowledgeConfig } from '../src/index.ts'
import { registerKnowledgeRoutes, type KnowledgeConnection } from '../src/transport.ts'
import type { KnowledgeDocument, KnowledgeEmbedding, KnowledgeStore } from '../src/types.ts'

const config = {
  store: { backend: 'pgvector' },
  embedding: { provider: 'openai-compatible' },
  template: {
    llm: { provider: 'p', model: 'm' },
    maxDocumentChars: 1000, maxQuestions: 5, extractionWindowChars: 1000, questionTemplateConcurrency: 1,
  },
  chunking: { targetChars: 100, maxChars: 200, overlapChars: 10 },
  generation: { defaultVariantCount: 3, maxVariantCount: 10 },
  uploads: { stagingDir: 'x', maxFileBytes: 1000 },
  search: { defaultTopK: 4, maxTopK: 8 },
} as ResolvedKnowledgeConfig

function fakeStore(overrides: Partial<KnowledgeStore> = {}): KnowledgeStore {
  return {
    dimensions: 4,
    ensure: vi.fn(async () => {}),
    registerDocument: vi.fn(async () => ({} as KnowledgeDocument)),
    setDocumentStatus: vi.fn(async () => {}),
    setChunkCount: vi.fn(async () => {}),
    insertChunks: vi.fn(async () => {}),
    insertTemplateArtifact: vi.fn(async () => 'a1'),
    getTemplateArtifact: vi.fn(async () => undefined),
    listChildArtifacts: vi.fn(async () => []),
    listDocumentArtifacts: vi.fn(async () => []),
    clearDocumentArtifacts: vi.fn(async () => {}),
    deleteDocument: vi.fn(async () => {}),
    listDocuments: vi.fn(async () => []),
    getDocument: vi.fn(async () => undefined),
    artifactCounts: vi.fn(async () => ({ chunkCount: 0, byKind: { document_template: 0, question: 0, question_template: 0, variant: 0 } })),
    failTransientDocuments: vi.fn(async () => 0),
    search: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    ...overrides,
  }
}

const embedding: KnowledgeEmbedding = {
  dimensions: 4,
  embed: vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0, 0, 0])),
}

describe('KnowledgeService', () => {
  it('fails ready() on a dimension mismatch', async () => {
    const service = new KnowledgeService(fakeStore({ dimensions: 8 }), embedding, {} as never, config)
    await expect(service.ready()).rejects.toThrow('dimensions')
  })

  it('recovers transient documents and delegates search', async () => {
    const store = fakeStore()
    const service = new KnowledgeService(store, embedding, {} as never, config)
    await service.ready()
    expect(store.failTransientDocuments).toHaveBeenCalledWith('interrupted by restart')
    await service.search({ query: '方程' })
    expect(store.search).toHaveBeenCalledWith(expect.objectContaining({ topK: 4 }))
  })

  it('does not re-enqueue a ready duplicate upload', async () => {
    const store = fakeStore({
      registerDocument: vi.fn(async () => ({ id: 'd1', status: 'ready' } as KnowledgeDocument)),
    })
    const service = new KnowledgeService(store, embedding, {} as never, config)
    const document = await service.submitDocument({
      mode: 'knowledge', sourceName: 'a.md', mime: 'text/markdown', sha256: 'x', data: new Uint8Array([1]),
    })
    expect(document.id).toBe('d1')
    expect(store.insertChunks).not.toHaveBeenCalled()
  })
})

describe('transport routes', () => {
  function captureRoutes(): { routes: Map<string, { fetch: (request: Request) => Promise<Response> }>; connection: KnowledgeConnection } {
    const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>()
    const connection: KnowledgeConnection = {
      fetch: {
        register: vi.fn((route: { path: string; fetch: (request: Request) => Promise<Response> }) => {
          routes.set(route.path, route)
          return async () => {}
        }),
      },
    }
    return { routes, connection }
  }

  it('rejects a bad upload mode and an empty body', async () => {
    const service = new KnowledgeService(fakeStore(), embedding, {} as never, config)
    const { routes, connection } = captureRoutes()
    registerKnowledgeRoutes(connection, service, { maxFileBytes: 1000 })
    const badMode = await routes.get('/api/knowledge.documents.upload')!.fetch(
      new Request('https://x/api/knowledge.documents.upload?mode=nope&name=a.md', { method: 'POST', body: 'x' }),
    )
    expect(badMode.status).toBe(400)
    const empty = await routes.get('/api/knowledge.documents.upload')!.fetch(
      new Request('https://x/api/knowledge.documents.upload?mode=knowledge&name=a.md', { method: 'POST', body: '' }),
    )
    expect(empty.status).toBe(400)
  })

  it('hashes, submits, and returns the document', async () => {
    const store = fakeStore({
      registerDocument: vi.fn(async () => ({ id: 'd1', status: 'staged', mode: 'knowledge', sourceName: 'a.md' } as KnowledgeDocument)),
    })
    const service = new KnowledgeService(store, embedding, {} as never, config)
    const { routes, connection } = captureRoutes()
    registerKnowledgeRoutes(connection, service, { maxFileBytes: 1000 })
    const response = await routes.get('/api/knowledge.documents.upload')!.fetch(
      new Request('https://x/api/knowledge.documents.upload?mode=knowledge&name=a.md', {
        method: 'POST',
        body: '内容',
        headers: { 'content-type': 'text/markdown' },
      }),
    )
    const body = await response.json() as { document: KnowledgeDocument }
    expect(body.document.id).toBe('d1')
    expect(store.registerDocument).toHaveBeenCalledWith(expect.objectContaining({ sha256: expect.any(String) }))
  })

  it('drains an over-cap upload and answers 413 JSON instead of resetting the socket', async () => {
    const service = new KnowledgeService(fakeStore(), embedding, {} as never, config)
    const { routes, connection } = captureRoutes()
    registerKnowledgeRoutes(connection, service, { maxFileBytes: 4 })
    let chunksRead = 0
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.close()
      },
    })
    // The tee'd branch observes the route actually consuming the whole body.
    const [routeBody, probeBody] = stream.tee()
    void probeBody.pipeTo(new WritableStream({ write() { chunksRead += 1 } })).catch(() => {})
    const response = await routes.get('/api/knowledge.documents.upload')!.fetch(
      new Request('https://x/api/knowledge.documents.upload?mode=knowledge&name=a.bin', {
        method: 'POST',
        body: routeBody,
        headers: { 'content-type': 'application/octet-stream' },
        // @ts-expect-error -- Node's Request accepts a ReadableStream body with duplex half.
        duplex: 'half',
      }),
    )
    expect(response.status).toBe(413)
    const body = await response.json() as { error: string }
    expect(body.error).toContain('maxFileBytes 4')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(chunksRead).toBe(2)
  })

  it('validates search difficulty and kind', async () => {
    const service = new KnowledgeService(fakeStore(), embedding, {} as never, config)
    const { routes, connection } = captureRoutes()
    registerKnowledgeRoutes(connection, service, { maxFileBytes: 1000 })
    const bad = await routes.get('/api/knowledge.search')!.fetch(
      new Request('https://x/api/knowledge.search', {
        method: 'POST',
        body: JSON.stringify({ query: 'q', difficulty: 'extreme' }),
      }),
    )
    expect(bad.status).toBe(400)
  })
})
