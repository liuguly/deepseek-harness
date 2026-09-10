/**
 * Markdown parser: ATX headings become heading blocks, fenced code blocks and
 * consecutive non-blank lines become text blocks, and the first level-1
 * heading becomes the document title.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse/markdown
 */

import type { ParsedBlock, ParsedDocument } from './types.ts'

/**
 * Parse markdown text into structural blocks.
 * @param text - the raw markdown text.
 * @returns the parsed document.
 */
export function parseMarkdown(text: string): ParsedDocument {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ParsedBlock[] = []
  let title: string | undefined
  let paragraph: string[] = []
  let fence: { readonly marker: string; readonly lines: string[] } | undefined

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'text', text: paragraph.join('\n').trim() })
    paragraph = []
  }

  for (const line of lines) {
    const fenceMatch = fence === undefined ? /^(\s*)(`{3,}|~{3,})/.exec(line) : undefined
    if (fence !== undefined) {
      if (line.trimStart().startsWith(fence.marker)) {
        blocks.push({ kind: 'text', text: fence.lines.join('\n') })
        fence = undefined
      } else {
        fence.lines.push(line)
      }
      continue
    }
    if (fenceMatch?.[2] !== undefined) {
      flushParagraph()
      fence = { marker: fenceMatch[2].charAt(0).repeat(3), lines: [] }
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      flushParagraph()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      if (title === undefined && heading[1].length === 1) title = heading[2]
      continue
    }
    if (line.trim().length === 0) {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }
  if (fence !== undefined) blocks.push({ kind: 'text', text: fence.lines.join('\n') })
  flushParagraph()
  return { ...(title === undefined ? {} : { title }), blocks }
}
