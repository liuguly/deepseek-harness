import { describe, expect, it } from 'vitest'
import { chunkParsedDocument } from '../src/chunk.ts'
import { parseDocument, parseMarkdown, parsePlaintext, ParseError } from '../src/parse/index.ts'
import { parseHtml } from '../src/parse/html.ts'
import { tokenize } from '../src/tokenize.ts'

describe('markdown parser', () => {
  it('extracts headings, paragraphs, and the first h1 title', () => {
    const parsed = parseMarkdown('# 高中数学\n\n## 第一章\n\n方程内容。\n\n```js\nconst a = 1\n```\n')
    expect(parsed.title).toBe('高中数学')
    expect(parsed.blocks).toEqual([
      { kind: 'heading', level: 1, text: '高中数学' },
      { kind: 'heading', level: 2, text: '第一章' },
      { kind: 'text', text: '方程内容。' },
      { kind: 'text', text: 'const a = 1' },
    ])
  })

  it('keeps an unclosed fence as text', () => {
    const parsed = parseMarkdown('```\nabc')
    expect(parsed.blocks).toEqual([{ kind: 'text', text: 'abc' }])
  })
})

describe('plaintext and html parsers', () => {
  it('splits plaintext on blank lines', () => {
    expect(parsePlaintext('a\nb\n\nc\n')).toEqual({ blocks: [{ kind: 'text', text: 'a\nb' }, { kind: 'text', text: 'c' }] })
  })

  it('maps html headings and drops script content', () => {
    const parsed = parseHtml('<title>T</title><script>bad()</script><h1>H</h1><p>P1</p><div>D2</div>')
    expect(parsed.title).toBe('T')
    expect(parsed.blocks).toEqual([
      { kind: 'heading', level: 1, text: 'H' },
      { kind: 'text', text: 'P1' },
      { kind: 'text', text: 'D2' },
    ])
  })
})

describe('parseDocument dispatch', () => {
  it('rejects unknown formats with a ParseError', async () => {
    await expect(parseDocument('file.zip', 'application/zip', new Uint8Array(1)))
      .rejects.toBeInstanceOf(ParseError)
  })

  it('routes markdown by extension', async () => {
    const parsed = await parseDocument('notes.md', '', new TextEncoder().encode('# A\n'))
    expect(parsed.blocks).toEqual([{ kind: 'heading', level: 1, text: 'A' }])
  })
})

describe('chunking', () => {
  const options = { targetChars: 50, maxChars: 80, overlapChars: 10 }

  it('merges small sections and keeps heading paths', () => {
    const drafts = chunkParsedDocument({
      blocks: [
        { kind: 'heading', level: 1, text: 'A' },
        { kind: 'text', text: '短。' },
        { kind: 'text', text: '很短。' },
      ],
    }, options)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]!.headingPath).toEqual(['A'])
    expect(drafts[0]!.content).toContain('短。')
  })

  it('splits oversized text at sentence boundaries with overlap', () => {
    const sentence = '这是一个测试句子，用于验证切分。'
    const drafts = chunkParsedDocument({
      blocks: [{ kind: 'text', text: sentence.repeat(20) }],
    }, options)
    expect(drafts.length).toBeGreaterThan(1)
    for (const draft of drafts) expect(draft.content.length).toBeLessThanOrEqual(options.maxChars + options.overlapChars)
  })
})

describe('tokenize', () => {
  it('drops whitespace and punctuation and respects the cap', () => {
    const tokens = tokenize('一元二次方程, x^2 = 1。', 4)
    expect(tokens).toHaveLength(4)
    expect(tokens).not.toContain(',')
  })
})
