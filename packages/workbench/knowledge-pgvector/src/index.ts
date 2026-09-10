/**
 * pgvector storage provider: bootstraps the configured database (creating it
 * when absent), installs the `vector` extension, applies monotonic schema
 * migrations, and registers the `knowledgeStore` seam implementation backed by
 * one connection pool.
 * @module @deepseek-ai/dsh-workbench-knowledge-pgvector
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PgKnowledgeStore, type PgStoreConfig } from './store.ts'

/** Cordis plugin name. */
export const name = 'workbench-knowledge-pgvector'
/** The provider owns its own connections and publishes the store seam. */
export const inject: readonly string[] = []

/** Plugin configuration. */
export interface Config {
  /** PostgreSQL host. */
  readonly host: string
  /** PostgreSQL port. @default 5432 */
  readonly port?: number
  /** PostgreSQL role name. */
  readonly user: string
  /** PostgreSQL password; injected from the environment via composition expressions. */
  readonly password: string
  /** Database hosting the knowledge store; created when absent. */
  readonly database: string
  /** Schema hosting the knowledge tables; created when absent. */
  readonly schema?: string
  /** Vector dimension the columns and HNSW indexes are built for; must equal the embedding provider's dimension. */
  readonly dimensions: number
  /** Maximum pool connections. @default 10 */
  readonly poolMax?: number
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  host: z.string().required(),
  port: z.number().min(1).max(65_535).default(5432),
  user: z.string().required(),
  password: z.string().required(),
  database: z.string().required(),
  schema: z.string().default('workbench_kb'),
  dimensions: z.number().step(1).min(2).max(20_000).required(),
  poolMax: z.number().step(1).min(1).max(100).default(10),
})

/**
 * Bootstrap the store and publish it as `knowledgeStore`. Activation awaits
 * the full ensure pass, so a missing database privilege, a missing pgvector
 * extension, or a dimension mismatch fails the mount loudly.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const storeConfig = config as PgStoreConfig
  const store = new PgKnowledgeStore(storeConfig)
  await store.ensure()
  ctx.provide('knowledgeStore', store)
  ctx.effect(() => async () => {
    await store.close()
  }, 'workbench-knowledge-pgvector: pool lifecycle')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The durable knowledge store provider seam. */
    knowledgeStore: import('@deepseek-ai/dsh-workbench-knowledge').KnowledgeStore
  }
}

export { PgKnowledgeStore } from './store.ts'
export type { PgStoreConfig } from './store.ts'
