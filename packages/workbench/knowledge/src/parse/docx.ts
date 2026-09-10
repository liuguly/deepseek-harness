/**
 * DOCX parser: mammoth converts the document to semantic HTML (heading styles
 * become h1–h6), and the HTML parser supplies the block model.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse/docx
 */

import mammoth from 'mammoth'
import { parseHtml } from './html.ts'
import type { ParsedDocument } from './types.ts'

/**
 * Parse a DOCX buffer into structural blocks.
 * @param data - raw DOCX bytes.
 * @returns the parsed document.
 * @throws when the document is not readable OOXML.
 */
export async function parseDocx(data: Uint8Array): Promise<ParsedDocument> {
  let html: string
  try {
    const result = await mammoth.convertToHtml({ buffer: Buffer.from(data) })
    html = result.value
  } catch (error) {
    throw new Error(`workbench-knowledge: docx parsing failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseHtml(html)
}
