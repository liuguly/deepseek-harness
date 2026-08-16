/**
 * Host gateway serving workspace file browsing to GUI clients: one-level
 * directory listings and bounded text reads over the host filesystem via
 * Node's stdlib (the same per-OS adaptation the directory-picker browse
 * backend relies on). Nothing renders on the host display, so the gateway
 * serves remote browsers equally. Policy decisions (whole-filesystem scope,
 * symlinks followed, hidden entries flagged but returned, listing and read
 * bounds) are recorded in the package README.
 * @module @deepseek-ai/dsh-host-workspace-files
 */

import { open, opendir, stat } from 'node:fs/promises'
import { join, posix, resolve, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type { WorkspaceFileEntry, WorkspaceFileListing, WorkspaceFileRead } from './types.ts'

export type * from './types.ts'

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/** One streamed listing candidate: the dirent facts a row needs, nothing else retained. */
interface ListingCandidate {
  /** Base name within the streamed level. */
  name: string
  /** Dirent says directory (no probe needed). */
  isDirectory: boolean
}

/**
 * Insert a streamed candidate into the name-sorted bounded window, evicting
 * the name-largest candidate when the window exceeds `keep`. Memory over an
 * arbitrarily large level therefore stays O(keep) regardless of how many
 * children the directory holds.
 * @param window - the name-ascending window, mutated in place.
 * @param candidate - the streamed candidate to place.
 * @param keep - the window bound.
 * @returns true when an eviction happened (the level has candidates beyond the window).
 */
export function boundedInsert(window: ListingCandidate[], candidate: ListingCandidate, keep: number): boolean {
  // Full window, name at or beyond the tail: one comparison rejects, so an
  // oversized level costs O(1) per candidate past the head instead of a
  // window scan (100k children against a 1,001 window must not approach
  // 10^8 comparisons).
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a full window (length === keep >= 1) has a tail
  if (window.length === keep && candidate.name.localeCompare(window[window.length - 1]!.name) >= 0) return true
  // Binary insertion keeps a retained candidate at O(log keep) comparisons.
  let lo = 0
  let hi = window.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    if (candidate.name.localeCompare(window[mid]!.name) < 0) hi = mid
    else lo = mid + 1
  }
  window.splice(lo, 0, candidate)
  if (window.length <= keep) return false
  window.pop()
  return true
}

/** Validated plugin configuration. */
export interface Config {
  /** Complete-result bound of one listing level (entries returned, then `truncated`). */
  maxEntries: number
  /** Read window of one file read in bytes; larger files return a prefix. */
  maxReadBytes: number
}

/** Message text of an unknown thrown value (fs errors are Error instances). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The `ctx.workspaceFiles` Remote gateway. Each call reads the host
 * filesystem fresh; the gateway owns no cache, watch, or cross-call state.
 */
export class WorkspaceFilesGateway extends TypertRemoteService {
  /**
   * `maxEntries` bounds the complete listing level a single `list` call may
   * materialize and put on the wire (following GitHub's web UI truncation at
   * 1,000 entries). `maxReadBytes` bounds one file read window so a huge
   * file never crosses the wire whole; the client shows the prefix.
   */
  static Config: z<Config> = z.object({
    maxEntries: z.natural().min(1).default(1000),
    maxReadBytes: z.natural().min(1).default(256 * 1024),
  })

  /**
   * @param ctx - registrant context carrying the Typert binding.
   * @param config - deployment's listing/read bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'workspaceFiles')
  }

  /**
   * List one directory level: name-sorted rows (directories and files
   * interleaved), bounded by `maxEntries` with `truncated` flagging a cut.
   * Symlinks resolve to their target kind through `stat`; broken or cyclic
   * links are skipped silently — the browser shows what can be opened.
   * @param path - fully qualified directory to list.
   * @returns the listing level.
   */
  @Remote('list')
  async list(path: string): Promise<WorkspaceFileListing> {
    if (!fullyQualified(path)) {
      throw new Error(`cannot list "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    // Stream the level (opendir, one dirent at a time) into a name-sorted
    // window of maxEntries + 1 candidates: memory stays bounded no matter
    // how many children the directory holds, and the +1 slot lets an
    // in-window extra row prove the cut.
    const keep = this.config.maxEntries + 1
    const window: ListingCandidate[] = []
    let evicted = false
    let level: Awaited<ReturnType<typeof opendir>> | undefined
    try {
      level = await opendir(target)
    } catch (error: unknown) {
      // A missing or unreadable directory is the caller's problem, reported
      // with its own path instead of a bare fs error.
      throw new Error(`cannot list ${target}: ${messageOf(error)}`)
    }
    try {
      for (;;) {
        const dirent = await level.read()
        if (dirent === null) break
        const candidate = {
          name: dirent.name,
          isDirectory: dirent.isDirectory() || dirent.isSymbolicLink(),
        }
        if (boundedInsert(window, candidate, keep)) evicted = true
      }
    } finally {
      // Manual read() never auto-closes; close on every exit.
      await level.close()
    }
    const entries: WorkspaceFileEntry[] = []
    let truncated = evicted
    for (let index = 0; index < window.length; index++) {
      const candidate = window[index]!
      const entryPath = join(target, candidate.name)
      try {
        // stat follows symlinks, so a link reports its target kind; broken
        // and cyclic links throw here and are skipped silently.
        const info = await stat(entryPath)
        const kind = info.isDirectory() ? 'directory' : 'file'
        entries.push({
          name: candidate.name,
          path: entryPath,
          kind,
          hidden: candidate.name.startsWith('.'),
          ...kind === 'file' ? { size: info.size } : {},
        })
      } catch {
        /* v8 ignore next -- a broken/cyclic link or vanished entry is skipped; the loop continues. */
        continue
      }
      if (entries.length === this.config.maxEntries) {
        // More window candidates remain after the cap: the level was cut.
        if (index + 1 < window.length) truncated = true
        break
      }
    }
    return { path: target, entries, truncated }
  }

  /**
   * Read one regular file as bounded UTF-8 text. The read window is capped
   * at `maxReadBytes`; larger files return a prefix with `truncated`, and a
   * NUL byte in the window flags `binary` so the client can refuse a
   * misleading text render. Non-regular targets (directories, sockets)
   * reject.
   * @param path - fully qualified file to read.
   * @returns the bounded text read.
   */
  @Remote('read')
  async read(path: string): Promise<WorkspaceFileRead> {
    if (!fullyQualified(path)) {
      throw new Error(`cannot read "${path}": not a fully qualified path`)
    }
    const target = resolve(path)
    const handle = await open(target, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile()) {
        throw new Error(`cannot read "${target}": not a regular file`)
      }
      const windowBytes = Math.min(info.size, this.config.maxReadBytes)
      const buffer = Buffer.alloc(windowBytes)
      const { bytesRead } = await handle.read(buffer, 0, windowBytes, 0)
      const slice = buffer.subarray(0, bytesRead)
      return {
        path: target,
        content: slice.toString('utf8'),
        byteLength: bytesRead,
        truncated: info.size > this.config.maxReadBytes,
        binary: slice.includes(0),
      }
    } finally {
      await handle.close()
    }
  }
}

export default WorkspaceFilesGateway
