import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceFilesGateway from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Fresh temp fixture directory with a known level; returns its absolute path. */
async function fixtureLevel(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-files-'))
  roots.push(root)
  await mkdir(join(root, 'src'))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'b.txt'), 'b')
  await writeFile(join(root, 'a.txt'), 'a')
  await writeFile(join(root, '.hidden'), 'h')
  return root
}

async function harness(config?: { maxEntries?: number; maxReadBytes?: number }): Promise<WorkspaceFilesGateway> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WorkspaceFilesGateway, {
    maxEntries: config?.maxEntries ?? 1000,
    maxReadBytes: config?.maxReadBytes ?? 256 * 1024,
  })
  return ctx.get('workspaceFiles') as WorkspaceFilesGateway
}

describe('WorkspaceFilesGateway', () => {
  it('publishes list and read under the workspaceFiles namespace', async () => {
    const gateway = await harness()
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'workspaceFiles',
      namespace: 'workspaceFiles',
    })
    expect(remoteMethods(gateway)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'read', invocation: { kind: 'direct' } },
    ])
  })

  it('lists one name-sorted level with kinds and hidden flags', async () => {
    const gateway = await harness()
    const root = await fixtureLevel()
    const listing = await gateway.list(root)
    expect(listing.path).toBe(root)
    expect(listing.truncated).toBe(false)
    expect(listing.entries.map(entry => entry.name)).toEqual(['.hidden', 'a.txt', 'b.txt', 'docs', 'src'])
    const src = listing.entries.find(entry => entry.name === 'src')
    expect(src).toMatchObject({ kind: 'directory', hidden: false })
    expect(src?.size).toBeUndefined()
    const file = listing.entries.find(entry => entry.name === 'a.txt')
    expect(file).toMatchObject({ kind: 'file', hidden: false, size: 1 })
    expect(listing.entries.find(entry => entry.name === '.hidden')?.hidden).toBe(true)
  })

  it('cuts a level at maxEntries and flags truncation', async () => {
    const gateway = await harness({ maxEntries: 2 })
    const root = await fixtureLevel()
    const listing = await gateway.list(root)
    expect(listing.entries).toHaveLength(2)
    expect(listing.truncated).toBe(true)
    // The name-sorted head is retained.
    expect(listing.entries.map(entry => entry.name)).toEqual(['.hidden', 'a.txt'])
  })

  it('rejects a relative listing path without rebasing it', async () => {
    const gateway = await harness()
    await expect(gateway.list('relative/path')).rejects.toThrow('not a fully qualified path')
  })

  it('rejects listing a missing directory', async () => {
    const gateway = await harness()
    const root = await fixtureLevel()
    await expect(gateway.list(join(root, 'nope'))).rejects.toThrow('cannot list')
  })

  it('reads a bounded text prefix and flags truncation', async () => {
    const gateway = await harness({ maxReadBytes: 4 })
    const root = await fixtureLevel()
    await writeFile(join(root, 'long.txt'), 'abcdefghij')
    const read = await gateway.read(join(root, 'long.txt'))
    expect(read.content).toBe('abcd')
    expect(read.byteLength).toBe(4)
    expect(read.truncated).toBe(true)
    expect(read.binary).toBe(false)
  })

  it('flags NUL bytes as binary', async () => {
    const gateway = await harness()
    const root = await fixtureLevel()
    await writeFile(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]))
    const read = await gateway.read(join(root, 'bin.dat'))
    expect(read.binary).toBe(true)
    expect(read.truncated).toBe(false)
  })

  it('rejects reading a directory', async () => {
    const gateway = await harness()
    const root = await fixtureLevel()
    await expect(gateway.read(join(root, 'src'))).rejects.toThrow('not a regular file')
  })

  it('rejects a relative read path', async () => {
    const gateway = await harness()
    await expect(gateway.read('relative/file.txt')).rejects.toThrow('not a fully qualified path')
  })
})
