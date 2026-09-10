/**
 * The pgvector `KnowledgeStore`: one pool against the configured database,
 * an idempotent ensure pass (database creation, `vector` extension, schema,
 * versioned DDL, dimension bookkeeping), and the full seam implementation.
 * All SQL qualifies the configured schema explicitly; identifiers are
 * validated against `^[a-z_][a-z0-9_]*$` before any DDL interpolation.
 * @module @deepseek-ai/dsh-workbench-knowledge-pgvector/store
 */

import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type {
  ArtifactCounts,
  DocumentListFilter,
  KnowledgeChunkInput,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
  KnowledgeStore,
  SearchKind,
  TemplateArtifactInput,
  TemplateArtifactRecord,
} from '@deepseek-ai/dsh-workbench-knowledge'
import { ensureDatabase } from './ensure.ts'

/** Current schema version; every release step appends exactly one migration. */
export const PG_STORE_SCHEMA_VERSION = 1

/** Postgres identifier guard for the two interpolated SQL names (database, schema). */
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/

/** Durable lifecycle states that indicate an in-flight ingest. */
const TRANSIENT_STATUSES = ['staged', 'parsing', 'chunking', 'embedding', 'generating'] as const

/** Validated store configuration; every field is required. */
export interface PgStoreConfig {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
  readonly schema: string
  readonly dimensions: number
  readonly poolMax: number
}

interface DocumentRow {
  readonly id: string
  readonly mode: string
  readonly title: string
  readonly source_name: string
  readonly mime: string
  readonly sha256: string
  readonly status: string
  readonly error: string | null
  readonly chunk_count: number
  readonly created_at: Date
  readonly updated_at: Date
}

interface ChunkSearchRow {
  readonly document_id: string
  readonly seq: number
  readonly content: string
  readonly distance: number
  readonly title: string
  readonly mode: string
}

interface TemplateSearchRow {
  readonly id: string
  readonly document_id: string
  readonly kind: string
  readonly parent_id: string | null
  readonly title: string | null
  readonly payload: unknown
  readonly difficulty: string | null
  readonly metadata: unknown
  readonly distance: number
  readonly title_document: string
  readonly mode: string
}

interface TemplateArtifactRow {
  readonly id: string
  readonly document_id: string
  readonly kind: string
  readonly parent_id: string | null
  readonly title: string | null
  readonly payload: unknown
  readonly difficulty: string | null
  readonly metadata: unknown
}

function artifactOf(row: TemplateArtifactRow): TemplateArtifactRecord {
  return {
    artifactId: row.id,
    documentId: row.document_id,
    kind: row.kind as TemplateArtifactRecord['kind'],
    ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
    ...(row.title === null ? {} : { title: row.title }),
    payload: row.payload,
    ...(row.difficulty === null ? {} : { difficulty: row.difficulty as NonNullable<TemplateArtifactRecord['difficulty']> }),
    ...(row.metadata === null ? {} : { metadata: row.metadata as NonNullable<TemplateArtifactRecord['metadata']> }),
  }
}

function documentOf(row: DocumentRow): KnowledgeDocument {
  return {
    id: row.id,
    mode: row.mode as KnowledgeDocument['mode'],
    title: row.title,
    sourceName: row.source_name,
    mime: row.mime,
    sha256: row.sha256,
    status: row.status as KnowledgeDocument['status'],
    ...(row.error === null ? {} : { error: row.error }),
    chunkCount: row.chunk_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * Render one embedding as a pgvector literal; values must be finite.
 * @param embedding - the vector values.
 * @returns the pgvector text literal.
 * @throws when any value is not finite.
 */
export function vectorLiteral(embedding: readonly number[]): string {
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new Error('workbench-knowledge-pgvector: embedding contains a non-finite value')
    }
  }
  return JSON.stringify(Array.from(embedding))
}

/**
 * The pgvector-backed {@link KnowledgeStore}. `ensure()` is idempotent and
 * concurrency-safe; every operation goes through one bounded pool.
 */
export class PgKnowledgeStore implements KnowledgeStore {
  readonly dimensions: number

  private ensured: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private pool: pg.Pool | undefined

  constructor(private readonly config: PgStoreConfig) {
    if (!IDENTIFIER_RE.test(config.database)) {
      throw new Error(`workbench-knowledge-pgvector: database name '${config.database}' violates ${IDENTIFIER_RE}`)
    }
    if (!IDENTIFIER_RE.test(config.schema)) {
      throw new Error(`workbench-knowledge-pgvector: schema name '${config.schema}' violates ${IDENTIFIER_RE}`)
    }
    this.dimensions = config.dimensions
  }

  /** @inheritdoc */
  ensure(): Promise<void> {
    this.ensured ??= this.doEnsure()
    return this.ensured
  }

  private connectionOptions(): Record<string, unknown> {
    return {
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      options: `-c search_path=${this.config.schema},public`,
    }
  }

  private async doEnsure(): Promise<void> {
    await ensureDatabase(this.connectionOptions(), this.config.database)
    const pool = new pg.Pool({ ...this.connectionOptions(), database: this.config.database, max: this.config.poolMax })
    pool.on('error', () => {
      // Idle-client connection loss surfaces on the next query; nothing to
      // reclaim here beyond keeping the process alive.
    })
    this.pool = pool
    await this.applySchema(pool)
  }

  private async applySchema(pool: pg.Pool): Promise<void> {
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector')
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code === '42501') {
        throw new Error(
          'workbench-knowledge-pgvector: creating the vector extension requires elevated privileges — run '
            + `CREATE EXTENSION vector; against ${this.config.database} as a superuser once, then retry`,
        )
      }
      if (code === 'undefined_object' || code === '0A000') {
        throw new Error(
          'workbench-knowledge-pgvector: the vector extension is not available on this server — install pgvector '
            + '(https://github.com/pgvector/pgvector) for PostgreSQL and retry',
        )
      }
      throw error
    }
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.config.schema}`)
    await pool.query(`CREATE TABLE IF NOT EXISTS ${this.config.schema}.kb_schema (key text PRIMARY KEY, value text NOT NULL)`)
    const bookkeeping = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM ${this.config.schema}.kb_schema WHERE key IN ('version', 'dimensions')`,
    )
    const rows = new Map(bookkeeping.rows.map(row => [row.key, row.value] as const))
    const storedVersion = rows.get('version')
    const storedDimensions = rows.get('dimensions')
    if (storedVersion === undefined) {
      if (storedDimensions !== undefined) {
        throw new Error(`workbench-knowledge-pgvector: kb_schema records dimensions ${storedDimensions} without a version`)
      }
      await this.createTables(pool)
      await pool.query(
        `INSERT INTO ${this.config.schema}.kb_schema (key, value) VALUES ('version', $1), ('dimensions', $2)`,
        [String(PG_STORE_SCHEMA_VERSION), String(this.config.dimensions)],
      )
      return
    }
    const version = Number(storedVersion)
    if (!Number.isInteger(version) || version > PG_STORE_SCHEMA_VERSION) {
      throw new Error(
        `workbench-knowledge-pgvector: store schema version ${storedVersion} is newer than this build (max ${PG_STORE_SCHEMA_VERSION})`,
      )
    }
    if (version < PG_STORE_SCHEMA_VERSION) {
      throw new Error(`workbench-knowledge-pgvector: migration from schema version ${version} is not implemented`)
    }
    if (storedDimensions !== String(this.config.dimensions)) {
      throw new Error(
        `workbench-knowledge-pgvector: store was built for ${storedDimensions}-dimension vectors but embedding is configured for `
          + `${this.config.dimensions}; change the embedding model or rebuild the store (drop the kb_ tables)`,
      )
    }
  }

  private async createTables(pool: pg.Pool): Promise<void> {
    // `dimensions` is a schemastery-validated integer (2..20000), so the DDL
    // interpolation below cannot inject SQL.
    const dim = this.config.dimensions
    const s = this.config.schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.kb_documents (
        id uuid PRIMARY KEY,
        mode text NOT NULL,
        title text NOT NULL,
        source_name text NOT NULL,
        mime text NOT NULL,
        sha256 text NOT NULL UNIQUE,
        status text NOT NULL,
        error text,
        chunk_count integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.kb_chunks (
        id bigserial PRIMARY KEY,
        document_id uuid NOT NULL REFERENCES ${s}.kb_documents (id) ON DELETE CASCADE,
        seq integer NOT NULL,
        content text NOT NULL,
        tokens jsonb NOT NULL,
        embedding vector(${dim}) NOT NULL
      )
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
        ON ${s}.kb_chunks USING hnsw (embedding vector_cosine_ops)
    `)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${s}.kb_templates (
        id bigserial PRIMARY KEY,
        document_id uuid NOT NULL REFERENCES ${s}.kb_documents (id) ON DELETE CASCADE,
        kind text NOT NULL,
        parent_id bigint REFERENCES ${s}.kb_templates (id) ON DELETE CASCADE,
        title text,
        payload jsonb NOT NULL,
        difficulty text,
        metadata jsonb,
        embedding vector(${dim}) NOT NULL
      )
    `)
    await pool.query(`CREATE INDEX IF NOT EXISTS kb_templates_difficulty_idx ON ${s}.kb_templates (difficulty)`)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS kb_templates_embedding_hnsw
        ON ${s}.kb_templates USING hnsw (embedding vector_cosine_ops)
    `)
  }

  private poolOf(): pg.Pool {
    if (this.pool === undefined) {
      throw new Error('workbench-knowledge-pgvector: the store is not initialized; call ensure() first')
    }
    return this.pool
  }

  /** @inheritdoc */
  async registerDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocument> {
    const pool = this.poolOf()
    const id = randomUUID()
    const inserted = await pool.query<DocumentRow>(
      `INSERT INTO ${this.config.schema}.kb_documents (id, mode, title, source_name, mime, sha256, status)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, 'staged')
       ON CONFLICT (sha256) DO NOTHING
       RETURNING *`,
      [id, input.mode, input.title, input.sourceName, input.mime, input.sha256],
    )
    const insertedRow = inserted.rows[0]
    if (insertedRow !== undefined) return documentOf(insertedRow)
    const existing = await pool.query<DocumentRow>(
      `SELECT * FROM ${this.config.schema}.kb_documents WHERE sha256 = $1`,
      [input.sha256],
    )
    const existingRow = existing.rows[0]
    if (existingRow === undefined) {
      throw new Error('workbench-knowledge-pgvector: document registration conflicted but no row was found')
    }
    return documentOf(existingRow)
  }

  /** @inheritdoc */
  async setDocumentStatus(id: string, status: KnowledgeDocument['status'], error?: string): Promise<void> {
    const result = await this.poolOf().query(
      `UPDATE ${this.config.schema}.kb_documents SET status = $2, error = $3, updated_at = now() WHERE id = $1::uuid`,
      [id, status, error ?? null],
    )
    if (result.rowCount === 0) {
      throw new Error(`workbench-knowledge-pgvector: document ${id} does not exist`)
    }
  }

  /** @inheritdoc */
  async setChunkCount(id: string, chunkCount: number): Promise<void> {
    await this.poolOf().query(
      `UPDATE ${this.config.schema}.kb_documents SET chunk_count = $2, updated_at = now() WHERE id = $1::uuid`,
      [id, chunkCount],
    )
  }

  /** @inheritdoc */
  async insertChunks(documentId: string, chunks: readonly KnowledgeChunkInput[]): Promise<void> {
    const client = await this.poolOf().connect()
    try {
      await client.query('BEGIN')
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO ${this.config.schema}.kb_chunks (document_id, seq, content, tokens, embedding)
           VALUES ($1::uuid, $2, $3, $4::jsonb, $5::vector)`,
          [documentId, chunk.seq, chunk.content, JSON.stringify(chunk.tokens), vectorLiteral(chunk.embedding)],
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  /** @inheritdoc */
  async insertTemplateArtifact(documentId: string, artifact: TemplateArtifactInput): Promise<string> {
    const result = await this.poolOf().query<{ id: string }>(
      `INSERT INTO ${this.config.schema}.kb_templates
         (document_id, kind, parent_id, title, payload, difficulty, metadata, embedding)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::vector)
       RETURNING id`,
      [
        documentId,
        artifact.kind,
        artifact.parentId ?? null,
        artifact.title ?? null,
        JSON.stringify(artifact.payload),
        artifact.difficulty ?? null,
        artifact.metadata === undefined ? null : JSON.stringify(artifact.metadata),
        vectorLiteral(artifact.embedding),
      ],
    )
    const inserted = result.rows[0]
    if (inserted === undefined) {
      throw new Error('workbench-knowledge-pgvector: artifact insert returned no id')
    }
    return inserted.id
  }

  /** @inheritdoc */
  async getTemplateArtifact(artifactId: string): Promise<TemplateArtifactRecord | undefined> {
    const result = await this.poolOf().query<TemplateArtifactRow>(
      `SELECT t.id::text AS id, t.document_id::text AS document_id, t.kind, t.parent_id::text AS parent_id,
              t.title, t.payload, t.difficulty, t.metadata
       FROM ${this.config.schema}.kb_templates t
       WHERE t.id = $1::bigint`,
      [artifactId],
    )
    const artifactRow = result.rows[0]
    return artifactRow === undefined ? undefined : artifactOf(artifactRow)
  }

  /** @inheritdoc */
  async listChildArtifacts(parentId: string): Promise<TemplateArtifactRecord[]> {
    const result = await this.poolOf().query<TemplateArtifactRow>(
      `SELECT t.id::text AS id, t.document_id::text AS document_id, t.kind, t.parent_id::text AS parent_id,
              t.title, t.payload, t.difficulty, t.metadata
       FROM ${this.config.schema}.kb_templates t
       WHERE t.parent_id = $1::bigint
       ORDER BY t.id`,
      [parentId],
    )
    return result.rows.map(artifactOf)
  }

  /** @inheritdoc */
  async listDocumentArtifacts(documentId: string): Promise<TemplateArtifactRecord[]> {
    const result = await this.poolOf().query<TemplateArtifactRow>(
      `SELECT t.id::text AS id, t.document_id::text AS document_id, t.kind, t.parent_id::text AS parent_id,
              t.title, t.payload, t.difficulty, t.metadata
       FROM ${this.config.schema}.kb_templates t
       WHERE t.document_id = $1::uuid
       ORDER BY t.id`,
      [documentId],
    )
    return result.rows.map(artifactOf)
  }

  /** @inheritdoc */
  async clearDocumentArtifacts(documentId: string): Promise<void> {
    const pool = this.poolOf()
    await pool.query(`DELETE FROM ${this.config.schema}.kb_chunks WHERE document_id = $1::uuid`, [documentId])
    await pool.query(`DELETE FROM ${this.config.schema}.kb_templates WHERE document_id = $1::uuid`, [documentId])
    await pool.query(
      `UPDATE ${this.config.schema}.kb_documents SET chunk_count = 0, updated_at = now() WHERE id = $1::uuid`,
      [documentId],
    )
  }

  /** @inheritdoc */
  async deleteDocument(id: string): Promise<void> {
    await this.poolOf().query(`DELETE FROM ${this.config.schema}.kb_documents WHERE id = $1::uuid`, [id])
  }

  /** @inheritdoc */
  async listDocuments(filter?: DocumentListFilter): Promise<KnowledgeDocument[]> {
    const result = filter?.mode === undefined
      ? await this.poolOf().query<DocumentRow>(`SELECT * FROM ${this.config.schema}.kb_documents ORDER BY created_at DESC`)
      : await this.poolOf().query<DocumentRow>(
        `SELECT * FROM ${this.config.schema}.kb_documents WHERE mode = $1 ORDER BY created_at DESC`,
        [filter.mode],
      )
    return result.rows.map(documentOf)
  }

  /** @inheritdoc */
  async getDocument(id: string): Promise<KnowledgeDocument | undefined> {
    const result = await this.poolOf().query<DocumentRow>(
      `SELECT * FROM ${this.config.schema}.kb_documents WHERE id = $1::uuid`,
      [id],
    )
    const documentRow = result.rows[0]
    return documentRow === undefined ? undefined : documentOf(documentRow)
  }

  /** @inheritdoc */
  async artifactCounts(documentId: string): Promise<ArtifactCounts> {
    const pool = this.poolOf()
    const byKindRows = await pool.query<{ kind: string; count: string }>(
      `SELECT kind, count(*)::text AS count FROM ${this.config.schema}.kb_templates WHERE document_id = $1::uuid GROUP BY kind`,
      [documentId],
    )
    const byKind = { document_template: 0, question: 0, question_template: 0, variant: 0 } as Record<TemplateArtifactInput['kind'], number>
    for (const row of byKindRows.rows) {
      if (row.kind in byKind) byKind[row.kind as TemplateArtifactInput['kind']] = Number(row.count)
    }
    const chunks = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${this.config.schema}.kb_chunks WHERE document_id = $1::uuid`,
      [documentId],
    )
    const chunkCountRow = chunks.rows[0]
    if (chunkCountRow === undefined) {
      throw new Error(`workbench-knowledge-pgvector: chunk count query for document ${documentId} returned no row`)
    }
    return { chunkCount: Number(chunkCountRow.count), byKind }
  }

  /** @inheritdoc */
  async failTransientDocuments(reason: string): Promise<number> {
    const result = await this.poolOf().query(
      `UPDATE ${this.config.schema}.kb_documents SET status = 'failed', error = $1, updated_at = now()
       WHERE status = ANY($2::text[])`,
      [reason, [...TRANSIENT_STATUSES]],
    )
    return result.rowCount ?? 0
  }

  /** @inheritdoc */
  async search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult[]> {
    const pool = this.poolOf()
    const vector = vectorLiteral(request.queryEmbedding)
    const templateKindWanted = request.kind === undefined || request.kind !== 'chunk'
    const chunkKindWanted = request.kind === undefined || request.kind === 'chunk'
    const chunkWanted = chunkKindWanted && request.difficulty === undefined
    const perSide = Math.max(request.topK, 1)

    const [chunkRows, templateRows] = await Promise.all([
      chunkWanted
        ? pool.query<ChunkSearchRow>(
          `SELECT c.document_id::text AS document_id, c.seq, c.content,
                  c.embedding <=> $1::vector AS distance, d.title, d.mode
           FROM ${this.config.schema}.kb_chunks c
           JOIN ${this.config.schema}.kb_documents d ON d.id = c.document_id
           WHERE ($2::text IS NULL OR d.mode = $2) AND ($3::text IS NULL OR c.document_id::text = $3)
           ORDER BY c.embedding <=> $1::vector
           LIMIT $4`,
          [vector, request.mode ?? null, request.documentId ?? null, perSide],
        )
        : Promise.resolve({ rows: [] as ChunkSearchRow[] }),
      templateKindWanted
        ? pool.query<TemplateSearchRow>(
          `SELECT t.id::text AS id, t.document_id::text AS document_id, t.kind, t.parent_id::text AS parent_id,
                  t.title, t.payload, t.difficulty, t.metadata, t.embedding <=> $1::vector AS distance,
                  d.title AS title_document, d.mode
           FROM ${this.config.schema}.kb_templates t
           JOIN ${this.config.schema}.kb_documents d ON d.id = t.document_id
           WHERE ($2::text IS NULL OR t.kind = $2) AND ($3::text IS NULL OR d.mode = $3)
             AND ($4::text IS NULL OR t.difficulty = $4) AND ($5::text IS NULL OR t.document_id::text = $5)
           ORDER BY t.embedding <=> $1::vector
           LIMIT $6`,
          [
            vector,
            request.kind ?? null,
            request.mode ?? null,
            request.difficulty ?? null,
            request.documentId ?? null,
            perSide,
          ],
        )
        : Promise.resolve({ rows: [] as TemplateSearchRow[] }),
    ])

    const results: KnowledgeSearchResult[] = []
    for (const row of chunkRows.rows) {
      results.push({
        kind: 'chunk',
        score: 1 - Number(row.distance),
        documentId: row.document_id,
        documentTitle: row.title,
        mode: row.mode as KnowledgeSearchResult['mode'],
        seq: row.seq,
        content: row.content,
      })
    }
    for (const row of templateRows.rows) {
      results.push({
        kind: row.kind as SearchKind,
        score: 1 - Number(row.distance),
        documentId: row.document_id,
        documentTitle: row.title_document,
        mode: row.mode as KnowledgeSearchResult['mode'],
        artifactId: row.id,
        ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
        ...(row.title === null ? {} : { title: row.title }),
        payload: row.payload,
        ...(row.difficulty === null ? {} : { difficulty: row.difficulty as NonNullable<KnowledgeSearchResult['difficulty']> }),
        ...(row.metadata === null ? {} : { metadata: row.metadata as NonNullable<KnowledgeSearchResult['metadata']> }),
      })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, request.topK)
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    this.closing ??= (async () => {
      await this.pool?.end()
      this.pool = undefined
    })()
    return this.closing
  }
}
