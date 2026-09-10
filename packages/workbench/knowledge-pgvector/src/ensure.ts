/**
 * Database-level bootstrap: connects to the maintenance database, creates the
 * target database when absent, and tolerates the concurrent-create race.
 * @module @deepseek-ai/dsh-workbench-knowledge-pgvector/ensure
 */

import pg from 'pg'

/**
 * Create `database` when it does not exist yet, using one short-lived client
 * against the server's `postgres` maintenance database.
 * @param connection - host-level connection facts (without a database).
 * @param database - validated target database name.
 */
export async function ensureDatabase(
  connection: Readonly<Record<string, unknown>>,
  database: string,
): Promise<void> {
  const client = new pg.Client({ ...connection, database: 'postgres' })
  try {
    await client.connect()
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
    if (exists.rowCount !== 0) return
    try {
      await client.query(`CREATE DATABASE ${database}`)
    } catch (error) {
      // 42P04 duplicate_database: another process won the create race; the
      // database exists either way, so treat it as success.
      if ((error as { code?: string }).code !== '42P04') throw error
    }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === '42501') {
      throw new Error(
        'workbench-knowledge-pgvector: the configured role lacks CREATEDB — create the database manually with '
          + `CREATE DATABASE ${database}; and retry`,
      )
    }
    if (code === '28P01' || code === '28000') {
      throw new Error('workbench-knowledge-pgvector: authentication failed — check the store credentials in the composition')
    }
    throw error
  } finally {
    await client.end().catch(() => {
      // A failed connect never opened a socket; ending is best-effort.
    })
  }
}
