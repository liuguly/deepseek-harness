import { afterEach, describe, expect, it, vi } from 'vitest'

process.env.TEST_EMBEDDING_KEY = 'k'

const { OpenAiCompatibleEmbedding, resolveConfig, resolveCredential } = await import('../src/index.ts')

function fetchWith(responder: (url: string, body: { input?: string[] }) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL, init?: { body?: string }) => {
    let body: { input?: string[] } = {}
    try {
      body = JSON.parse(init?.body ?? '{}') as { input?: string[] }
    } catch {
      body = {}
    }
    return responder(String(url), body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function embeddingsFor(count: number): string {
  return JSON.stringify({ data: Array.from({ length: count }, (_, index) => ({ embedding: [index, 0, 0, 0] })) })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const config = {
  baseUrl: 'https://api.example.com/v1', model: 'm', dimensions: 4, batchSize: 2,
  credentialRef: 'env:TEST_EMBEDDING_KEY', timeoutMs: 5_000,
}

describe('resolveConfig', () => {
  it('normalizes the endpoint and rejects a bad URL', () => {
    expect(resolveConfig(config).endpoint).toBe('https://api.example.com/v1/embeddings')
    expect(() => resolveConfig({ ...config, baseUrl: 'not a url' })).toThrow('valid URL')
  })

  it('fails loud when the credential variable is missing', () => {
    delete process.env.TEST_EMBEDDING_KEY
    expect(() => resolveCredential('env:TEST_EMBEDDING_KEY')).toThrow('TEST_EMBEDDING_KEY')
    process.env.TEST_EMBEDDING_KEY = 'k'
    expect(resolveCredential('env:TEST_EMBEDDING_KEY')).toBe('k')
    expect(() => resolveCredential('vault:x')).toThrow('env:<NAME>')
  })})

describe('OpenAiCompatibleEmbedding', () => {
  it('splits inputs into configured batches and preserves order', async () => {
    fetchWith((_url, body) => ({
      ok: true,
      text: async () => embeddingsFor(body.input?.length ?? 0),
    }) as Response)
    const embedding = new OpenAiCompatibleEmbedding(resolveConfig(config))
    const vectors = await embedding.embed(['a', 'b', 'c'])
    expect(vectors).toEqual([[0, 0, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]])
  })

  it('rejects a misaligned dimension', async () => {
    fetchWith(() => ({
      ok: true,
      text: async () => JSON.stringify({ data: [{ embedding: [1, 0] }] }),
    }) as Response)
    const embedding = new OpenAiCompatibleEmbedding(resolveConfig(config))
    await expect(embedding.embed(['a'])).rejects.toThrow('dimensions')
  })

  it('retries one transient 5xx failure', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
      calls += 1
      if (calls === 1) return { ok: false, status: 503, statusText: 'unavailable', text: async () => 'boom' } as Response
      const body = JSON.parse(init?.body ?? '{}') as { input?: string[] }
      return { ok: true, text: async () => embeddingsFor(body.input?.length ?? 1) } as Response
    }))
    const embedding = new OpenAiCompatibleEmbedding(resolveConfig(config))
    await expect(embedding.embed(['a'])).resolves.toEqual([[0, 0, 0, 0]])
    expect(calls).toBe(2)
  })
})
