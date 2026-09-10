/**
 * Chunking over parsed blocks: heading blocks open sections, text accumulates
 * within a section, oversized paragraphs split on sentence boundaries with
 * configured overlap, and small adjacent sections merge toward the target
 * size. Pure and deterministic; embedding happens elsewhere.
 * @module @deepseek-ai/dsh-workbench-knowledge/chunk
 */

import type { ParsedDocument } from './parse/types.ts'

/** Chunk sizing bounds. */
export interface ChunkingOptions {
  /** Merge sections up to this size. */
  readonly targetChars: number
  /** Hard upper bound per chunk. */
  readonly maxChars: number
  /** Characters of the previous split carried into the next chunk. */
  readonly overlapChars: number
}

/** One chunk draft; the heading path names where it came from. */
export interface ChunkDraft {
  readonly content: string
  readonly headingPath: readonly string[]
}

function splitOversized(text: string, options: ChunkingOptions): string[] {
  if (text.length <= options.maxChars) return [text]
  const pieces: string[] = []
  let pending = text
  while (pending.length > options.maxChars) {
    const window = pending.slice(0, options.maxChars)
    let cut = -1
    for (let index = window.length - 1; index >= Math.floor(options.maxChars / 2); index -= 1) {
      const char = window[index]
      if (char !== undefined && '。！？；!?;'.includes(char)) {
        cut = index + 1
        break
      }
    }
    if (cut === -1) cut = window.length
    pieces.push(pending.slice(0, cut))
    const overlap = options.overlapChars > 0 ? pending.slice(Math.max(0, cut - options.overlapChars), cut) : ''
    pending = overlap + pending.slice(cut)
  }
  if (pending.trim().length > 0) pieces.push(pending)
  return pieces
}

/**
 * Chunk a parsed document into bounded drafts.
 * @param parsed - parser output.
 * @param options - sizing bounds.
 * @returns ordered chunk drafts.
 */
export function chunkParsedDocument(parsed: ParsedDocument, options: ChunkingOptions): ChunkDraft[] {
  interface Section {
    readonly headingPath: string[]
    readonly parts: string[]
  }
  const sections: Section[] = []
  let headingPath: string[] = []
  let current: Section = { headingPath, parts: [] }
  const flush = (): void => {
    if (current.parts.length > 0) sections.push(current)
  }
  for (const block of parsed.blocks) {
    if (block.kind === 'heading') {
      flush()
      headingPath = [...headingPath.slice(0, block.level - 1), block.text]
      current = { headingPath, parts: [] }
      continue
    }
    for (const piece of splitOversized(block.text, options)) {
      current.parts.push(piece)
      // A single block can exceed one chunk after splitting; keep later
      // pieces in the same section (they re-split deterministically below).
      if (piece.length >= options.maxChars) {
        flush()
        current = { headingPath, parts: [] }
      }
    }
  }
  flush()

  const drafts: ChunkDraft[] = []
  let pendingPath: readonly string[] = []
  let pendingParts: string[] = []
  const flushPending = (): void => {
    if (pendingParts.length === 0) return
    const content = pendingParts.join('\n\n').trim()
    if (content.length > 0) drafts.push({ content, headingPath: pendingPath })
    pendingParts = []
  }
  for (const section of sections) {
    const size = section.parts.reduce((sum, part) => sum + part.length + 2, 0)
    if (size < options.targetChars && pendingParts.length > 0
      && pendingParts.reduce((sum, part) => sum + part.length + 2, 0) + size <= options.targetChars
      && pendingPath.join('>') === section.headingPath.join('>')) {
      pendingParts.push(...section.parts)
      continue
    }
    flushPending()
    pendingPath = section.headingPath
    if (size <= options.maxChars) {
      pendingParts.push(...section.parts)
      continue
    }
    for (const piece of splitOversized(section.parts.join('\n\n'), options)) {
      drafts.push({ content: piece, headingPath: section.headingPath })
    }
  }
  flushPending()
  return drafts
}
