/**
 * Wire vocabulary of the workspace-files Remote: one-level directory listings
 * and bounded text reads. Pure JSON — every field crosses the browser/host
 * wire through the generated Typert codecs, so nothing here may hold a
 * function, class, or brand at runtime.
 */

/** One row of a directory listing level. */
export interface WorkspaceFileEntry {
  /** Base name within the listed directory. */
  name: string
  /** Fully qualified path of the entry (join of the listing root and name). */
  path: string
  /** Target kind; symlinks resolve through `stat`, so a link reports its target. */
  kind: 'directory' | 'file'
  /** File size in bytes; present for files, absent for directories. */
  size?: number
  /** POSIX hidden convention: name starts with '.'. The client owns whether hidden rows show. */
  hidden: boolean
}

/** One directory level: name-sorted rows bounded by the gateway config. */
export interface WorkspaceFileListing {
  /** Fully qualified listed directory. */
  path: string
  /** Name-sorted entries of one level (directories and files interleaved). */
  entries: WorkspaceFileEntry[]
  /** True when the level was cut at the configured `maxEntries` bound. */
  truncated: boolean
}

/** One file read: a bounded UTF-8 text projection of a regular file. */
export interface WorkspaceFileRead {
  /** Fully qualified file path. */
  path: string
  /** Decoded text of the read window (lossy UTF-8). */
  content: string
  /** Bytes actually read, at most the configured `maxReadBytes`. */
  byteLength: number
  /** True when the file is larger than the read window (content is a prefix). */
  truncated: boolean
  /** True when the read window contains a NUL byte — the file is binary-ish. */
  binary: boolean
}
