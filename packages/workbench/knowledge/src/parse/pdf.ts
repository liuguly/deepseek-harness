/**
 * PDF parser: pdfjs-dist (legacy build) extracts the per-page text layer.
 * Pages with no text are skipped; a document whose every page is empty fails
 * with the `no-text-layer` code so the caller can surface the scanned-PDF
 * hint.
 * @module @deepseek-ai/dsh-workbench-knowledge/parse/pdf
 */

import type { ParsedBlock, ParsedDocument } from './types.ts'
import { ParseError } from './types.ts'

type PdfDocument = {
  readonly numPages: number
  getPage: (page: number) => Promise<{ getTextContent: () => Promise<{ items: readonly { str?: string }[] }> }>
  destroy: () => Promise<void>
}

type PdfjsModule = {
  getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean }) => { promise: Promise<PdfDocument> }
}

let pdfjs: PdfjsModule | undefined

async function loadPdfjs(): Promise<PdfjsModule> {
  pdfjs ??= (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule
  return pdfjs
}

/**
 * Parse a PDF buffer into per-page text blocks.
 * @param data - raw PDF bytes.
 * @param signal - cancellation between pages.
 * @returns the parsed document.
 * @throws {@link ParseError} `no-text-layer` when no page yields text.
 */
export async function parsePdf(data: Uint8Array, signal?: AbortSignal): Promise<ParsedDocument> {
  const pdfjsLib = await loadPdfjs()
  const doc = await pdfjsLib.getDocument({ data }).promise
  try {
    const blocks: ParsedBlock[] = []
    let extracted = 0
    for (let page = 1; page <= doc.numPages; page += 1) {
      signal?.throwIfAborted()
      const content = await doc.getPage(page).then(current => current.getTextContent())
      const text = content.items.map(item => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim()
      if (text.length === 0) continue
      extracted += 1
      blocks.push({ kind: 'text', text: `[第 ${page} 页]\n${text}` })
    }
    if (extracted === 0) {
      throw new ParseError('no-text-layer', 'PDF has no extractable text layer (scanned document); OCR is not supported')
    }
    return { blocks }
  } finally {
    await doc.destroy()
  }
}
