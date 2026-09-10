/**
 * HTML parser: strips `script`/`style`/`template`, maps `h1`–`h6` to heading
 * blocks and block-level elements to text blocks. The document title comes
 * from `<title>` or the first heading. Uses node-html-parser.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse/html
 */

import { parse } from 'node-html-parser'
import type { ParsedBlock, ParsedDocument } from './types.ts'

const BLOCK_TAGS = new Set(['p', 'li', 'blockquote', 'pre', 'div', 'section', 'article', 'td', 'th', 'dd', 'dt', 'figcaption', 'tr'])

/**
 * Parse an HTML string into structural blocks.
 * @param html - the raw HTML text.
 * @returns the parsed document.
 */
export function parseHtml(html: string): ParsedDocument {
  const root = parse(html)
  for (const tag of ['script', 'style', 'template', 'noscript']) {
    for (const node of root.querySelectorAll(tag)) node.remove()
  }
  const title = root.querySelector('title')?.text.trim()
  const body = root.querySelector('body') ?? root
  const blocks: ParsedBlock[] = []
  const walk = (node: ReturnType<typeof parse>): void => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue
      const element = child as unknown as { tagName?: string; text: string; childNodes: unknown[] }
      const tag = (element.tagName ?? '').toLowerCase()
      const heading = /^h([1-6])$/.exec(tag)
      if (heading !== null) {
        const text = element.text.replace(/\s+/g, ' ').trim()
        if (text.length > 0) blocks.push({ kind: 'heading', level: Number(heading[1]), text })
        continue
      }
      if (BLOCK_TAGS.has(tag)) {
        const text = element.text.replace(/\s+/g, ' ').trim()
        if (text.length > 0) blocks.push({ kind: 'text', text })
        continue
      }
      walk(element as unknown as ReturnType<typeof parse>)
    }
  }
  walk(body)
  const firstHeading = blocks.find(block => block.kind === 'heading')
  const resolvedTitle = title !== undefined && title.length > 0
    ? title
    : firstHeading?.kind === 'heading' ? firstHeading.text : undefined
  return { ...(resolvedTitle === undefined ? {} : { title: resolvedTitle }), blocks }
}
