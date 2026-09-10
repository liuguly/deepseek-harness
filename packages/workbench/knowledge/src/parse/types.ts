/**
 * Format-agnostic parsed document model: an optional title plus ordered
 * heading/text blocks. Chunking consumes blocks; parsers produce them.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse/types
 */

/** One structural element of a parsed document. */
export type ParsedBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }

/** Parser output shared by every format. */
export interface ParsedDocument {
  /** Document title when the format declares one (first heading, `<title>`, or front matter). */
  readonly title?: string
  readonly blocks: readonly ParsedBlock[]
}

/** Reason a format cannot be parsed. */
export class ParseError extends Error {
  constructor(
    /** Machine-readable cause, e.g. `no-text-layer`. */
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ParseError'
  }
}
