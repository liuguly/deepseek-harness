/**
 * Chinese-aware word tokenization over `Intl.Segmenter` with a stored-token
 * cap. Tokens power result display and future hybrid retrieval; they never
 * gate ingest.
 * @module @deepseek-ai/dsh-workbench-knowledge/tokenize
 */

let segmenter: Intl.Segmenter | undefined

function segmenterOf(): Intl.Segmenter {
  segmenter ??= new Intl.Segmenter('zh', { granularity: 'word' })
  return segmenter
}

/**
 * Split text into word tokens (CJK words and word-like runs), dropping
 * whitespace and pure punctuation segments.
 * @param text - chunk content.
 * @param cap - maximum token count; the tail is dropped.
 * @returns ordered tokens.
 */
export function tokenize(text: string, cap: number): string[] {
  const tokens: string[] = []
  for (const segment of segmenterOf().segment(text)) {
    if (tokens.length >= cap) break
    const value = segment.segment
    if (value.trim().length === 0) continue
    if (/^\p{P}+$/u.test(value)) continue
    tokens.push(value)
  }
  return tokens
}
