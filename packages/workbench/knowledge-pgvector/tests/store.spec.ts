import { beforeEach, describe, expect, it, vi } from 'vitest'

type QueryHandler = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>

let handler: QueryHandler
const executed: string[] = []

vi.mock('pg', () => {
  class FakePool {
    async query(sql: string, values?: unknown[]) {
      executed.push(sql)
      return handler(sql, values)
    }
    async connect() {
      return {
        query: async (sql: string, values?: unknown[]) => {
          executed.push(sql)
          return handler(sql, values)
        },
        release: () => {},
      }
    }
    async end() {}
    on() {}
  }
  class FakeClient {
    async connect() {}
    async query(sql: string, values?: unknown[]) {
      executed.push(sql)
      return handler(sql, values)
    }
    async end() {}
  }
  return { default: { Pool: FakePool, Client: FakeClient }, Pool: FakePool, Client: FakeClient }
})

const { PgKnowledgeStore, vectorLiteral, PG_STORE_SCHEMA_VERSION } = await import('../src/store.ts')
const { ensureDatabase } = await import('../src/ensure.ts')

const config = {
  host: 'h', port: 5432, user: 'u', password: 'p', database: 'db', schema: 'workbench_kb',
  dimensions: 4, poolMax: 2,
}

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000001', mode: 'knowledge', title: 'T', source_name: 'a.md',
    mime: 'text/markdown', sha256: 's1', status: 'ready', error: null, chunk_count: 2,
    created_at: new Date(0), updated_at: new Date(0), ...overrides,
  }
}

beforeEach(() => {
  executed.length = 0
  handler = async (sql) => {
    if (sql.includes('pg_database')) return { rows: [], rowCount: 0 }
    if (sql.includes('CREATE DATABASE')) return { rows: [], rowCount: null }
    if (sql.includes('kb_schema')) return { rows: [{ key: 'version', value: String(PG_STORE_SCHEMA_VERSION) }, { key: 'dimensions', value: '4' }], rowCount: 2 }
    return { rows: [], rowCount: 0 }
  }
})

describe('vectorLiteral', () => {
  it('renders a JSON literal and rejects non-finite values', () => {
    expect(vectorLiteral([1, 0.5])).toBe('[1,0.5]')
    expect(() => vectorLiteral([Number.NaN])).toThrow('non-finite')
  })
})

describe('PgKnowledgeStore.ensure', () => {
  it('bootstraps database, extension, and schema bookkeeping', async () => {
    handler = async (sql) => {
      if (sql.includes('pg_database')) return { rows: [], rowCount: 0 }
      if (sql.includes('CREATE DATABASE')) return { rows: [], rowCount: null }
      if (sql.includes('kb_schema')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 0 }
    }
    const store = new PgKnowledgeStore(config)
    await store.ensure()
    expect(executed.some(sql => sql.includes('CREATE DATABASE db'))).toBe(true)
    expect(executed.some(sql => sql.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true)
    expect(executed.some(sql => sql.includes('vector(4)'))).toBe(true)
  })

  it('fails loud on a recorded dimension mismatch', async () => {
    handler = async (sql) => {
      if (sql.includes('pg_database')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
      if (sql.includes('kb_schema')) return { rows: [{ key: 'version', value: String(PG_STORE_SCHEMA_VERSION) }, { key: 'dimensions', value: '8' }], rowCount: 2 }
      return { rows: [], rowCount: 0 }
    }
    const store = new PgKnowledgeStore(config)
    await expect(store.ensure()).rejects.toThrow('rebuild the store')
  })

  it('names the privilege remediation when extension creation is forbidden', async () => {
    handler = async (sql) => {
      const error = Object.assign(new Error('denied'), { code: '42501' })
      if (sql.includes('CREATE DATABASE')) return { rows: [], rowCount: null }
      if (sql.includes('CREATE EXTENSION')) throw error
      if (sql.includes('pg_database')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }
    const store = new PgKnowledgeStore(config)
    await expect(store.ensure()).rejects.toThrow('superuser')
  })
})

describe('PgKnowledgeStore documents', () => {
  it('returns the existing row on a sha256 conflict', async () => {
    handler = async (sql) => {
      if (sql.includes('pg_database')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
      if (sql.includes('kb_schema')) return { rows: [{ key: 'version', value: String(PG_STORE_SCHEMA_VERSION) }, { key: 'dimensions', value: '4' }], rowCount: 2 }
      if (sql.includes('ON CONFLICT')) return { rows: [], rowCount: 0 }
      if (sql.includes('WHERE sha256')) return { rows: [documentRow()], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }
    const store = new PgKnowledgeStore(config)
    await store.ensure()
    const document = await store.registerDocument({
      mode: 'knowledge', title: 'T', sourceName: 'a.md', mime: 'text/markdown', sha256: 's1',
    })
    expect(document.sha256).toBe('s1')
  })

  it('merges chunk and template hits by score and skips chunks on a difficulty filter', async () => {
    handler = async (sql) => {
      if (sql.includes('pg_database')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
      if (sql.includes('kb_schema')) return { rows: [{ key: 'version', value: String(PG_STORE_SCHEMA_VERSION) }, { key: 'dimensions', value: '4' }], rowCount: 2 }
      if (sql.includes('kb_chunks')) {
        return { rows: [{ document_id: 'd1', seq: 0, content: 'c', distance: 0.1, title: 'T', mode: 'knowledge' }], rowCount: 1 }
      }
      if (sql.includes('kb_templates')) {
        return {
          rows: [{
            id: '5', document_id: 'd1', kind: 'question_template', parent_id: null, title: 'p',
            payload: {}, difficulty: 'hard', metadata: { subject: '数学' }, distance: 0.3,
            title_document: 'T', mode: 'template',
          }],
          rowCount: 1,
        }
      }
      return { rows: [], rowCount: 0 }
    }
    const store = new PgKnowledgeStore(config)
    await store.ensure()
    const merged = await store.search({ queryEmbedding: [1, 0, 0, 0], topK: 5 })
    expect(merged.map(entry => entry.kind)).toEqual(['chunk', 'question_template'])
    expect(merged[0]!.score).toBeCloseTo(0.9)
    executed.length = 0
    const filtered = await store.search({ queryEmbedding: [1, 0, 0, 0], topK: 5, difficulty: 'hard' })
    expect(filtered).toHaveLength(1)
    expect(executed.some(sql => sql.includes('kb_chunks'))).toBe(false)
  })
})

describe('ensureDatabase', () => {
  it('names the CREATEDB remediation on insufficient privilege', async () => {
    handler = async (sql) => {
      if (sql.includes('pg_database')) return { rows: [], rowCount: 0 }
      throw Object.assign(new Error('denied'), { code: '42501' })
    }
    await expect(ensureDatabase({}, 'db')).rejects.toThrow('CREATE DATABASE db')
  })
})
