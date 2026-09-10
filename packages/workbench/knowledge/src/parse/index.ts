/**
 * Parser dispatch: picks the format parser from the file extension, falling
 * back to the MIME type. Unknown formats fail with an explicit error.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse
 */

import { parseDocx } from './docx.ts'
import { parseHtml } from './html.ts'
import { parseMarkdown } from './markdown.ts'
import { parsePdf } from './pdf.ts'
import { parsePlaintext } from './plaintext.ts'
import { ParseError, type ParsedDocument } from './types.ts'
export { ParseError, type ParsedBlock, type ParsedDocument } from './types.ts'
export { parseMarkdown } from './markdown.ts'
export { parsePlaintext } from './plaintext.ts'
export { parseHtml } from './html.ts'
export { parseDocx } from './docx.ts'
export { parsePdf } from './pdf.ts'

const EXTENSION_PARSERS = new Map<string, 'markdown' | 'plaintext' | 'pdf' | 'docx' | 'html'>([
  ['.md', 'markdown'], ['.markdown', 'markdown'], ['.mdown', 'markdown'],
  ['.txt', 'plaintext'], ['.text', 'plaintext'],
  ['.pdf', 'pdf'],
  ['.docx', 'docx'],
  ['.html', 'html'], ['.htm', 'html'], ['.xhtml', 'html'],
])

const MIME_PARSERS = new Map<string, 'markdown' | 'plaintext' | 'pdf' | 'docx' | 'html'>([
  ['text/markdown', 'markdown'],
  ['text/plain', 'plaintext'],
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['text/html', 'html'],
])

function formatOf(sourceName: string, mime: string): 'markdown' | 'plaintext' | 'pdf' | 'docx' | 'html' {
  const dot = sourceName.lastIndexOf('.')
  const extension = dot === -1 ? '' : sourceName.slice(dot).toLowerCase()
  return EXTENSION_PARSERS.get(extension) ?? MIME_PARSERS.get(mime.toLowerCase())
    ?? (() => { throw new ParseError('unsupported-format', `unsupported document format: ${sourceName} (${mime})`) })()
}

/**
 * Parse one uploaded document into structural blocks.
 * @param sourceName - original file name; the extension selects the parser.
 * @param mime - declared MIME type; used when the extension is unknown.
 * @param data - raw document bytes.
 * @param signal - cancellation between pages.
 * @returns the parsed document.
 * @throws {@link ParseError} for unsupported formats and unreadable content.
 */
export async function parseDocument(sourceName: string, mime: string, data: Uint8Array, signal?: AbortSignal): Promise<ParsedDocument> {
  const format = formatOf(sourceName, mime)
  if (format === 'pdf') return parsePdf(data, signal)
  if (format === 'docx') return parseDocx(data)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data)
  if (format === 'markdown') return parseMarkdown(text)
  if (format === 'html') return parseHtml(text)
  return parsePlaintext(text)
}
