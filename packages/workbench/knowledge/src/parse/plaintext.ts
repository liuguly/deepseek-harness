/**
 * Plain-text parser: consecutive non-blank lines become text blocks; no
 * structure is invented.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse/plaintext
 */

import type { ParsedBlock, ParsedDocument } from './types.ts'

/**
 * Parse plain text into paragraph blocks.
 * @param text - the raw plain text.
 * @returns the parsed document.
 */
export function parsePlaintext(text: string): ParsedDocument {
  const blocks: ParsedBlock[] = []
  let paragraph: string[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim().length === 0) {
      if (paragraph.length > 0) blocks.push({ kind: 'text', text: paragraph.join('\n').trim() })
      paragraph = []
      continue
    }
    paragraph.push(line)
  }
  if (paragraph.length > 0) blocks.push({ kind: 'text', text: paragraph.join('\n').trim() })
  return { blocks }
}
