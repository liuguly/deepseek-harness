import { describe, expect, it, vi } from 'vitest'
import { createLlmCaller, extractJson } from '../src/llm.ts'
import {
  runTemplatePipeline,
  validateMetadata,
  validateQuestion,
  validateVariantTemplate,
  type TemplatePipelineConfig,
} from '../src/template-pipeline.ts'
import type { KnowledgeStore } from '../src/types.ts'

function llmWith(replies: string[]): { stream: ReturnType<typeof vi.fn> } {
  const repliesCopy = [...replies]
  return {
    stream: vi.fn(() => ({
      async * [Symbol.asyncIterator]() {
        const reply = repliesCopy.shift() ?? ''
        yield { type: 'block-start', index: 0, blockType: 'text' } as never
        yield { type: 'text-delta', index: 0, text: reply } as never
        yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } } as never
        yield { type: 'finish', reason: { kind: 'stop' } } as never
      },
    })),
  }
}

const config: TemplatePipelineConfig = {
  maxDocumentChars: 60_000,
  maxQuestions: 10,
  extractionWindowChars: 5_000,
  questionTemplateConcurrency: 2,
}

const metadata = {
  subject: '数学', topic: '方程', questionType: '解答题',
  knowledgePoints: ['二次方程'], keywords: ['方程'],
}

const question = {
  stem: '解方程 x^2-1=0', knowledgePoints: ['二次方程'], sourceLocation: '第一章', difficulty: 'normal',
}

const variantTemplate = {
  pattern: '一元二次方程求解', variables: [{ name: 'x', description: '未知数', valueRange: '实数' }],
  constraints: ['系数为整数'], solutionStrategy: '因式分解',
  knowledgePoints: ['二次方程'], difficulty: 'normal',
  generationPrompt: '按 {difficulty} 难度出一题',
}

describe('extractJson', () => {
  it('parses fenced and embedded JSON', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('前置说明 {"a":[1]} 后置')).toEqual({ a: [1] })
    expect(() => extractJson('没有 JSON')).toThrow()
  })
})

describe('validators', () => {
  it('rejects an out-of-enum difficulty', () => {
    expect(() => validateQuestion({ ...question, difficulty: 'extreme' })).toThrow('difficulty')
    expect(validateQuestion(question).difficulty).toBe('normal')
    expect(validateMetadata(metadata).subject).toBe('数学')
    expect(validateVariantTemplate(variantTemplate).generationPrompt).toContain('{difficulty}')
  })
})

describe('createLlmCaller', () => {
  it('assembles text blocks and surfaces error finishes', async () => {
    const caller = createLlmCaller(llmWith(['你好世界']) as never, { provider: 'p', model: 'm' })
    await expect(caller.complete({ system: 's', user: 'u', maxTokens: 10 })).resolves.toBe('你好世界')
    const failing = {
      stream: () => ({
        async * [Symbol.asyncIterator]() {
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'X' } } } as never
        },
      }),
    }
    await expect(createLlmCaller(failing as never, { provider: 'p', model: 'm' })
      .complete({ system: 's', user: 'u', maxTokens: 10 })).rejects.toThrow('boom')
  })
})

describe('runTemplatePipeline', () => {
  function fakeStore() {
    const inserted: Array<{ kind: string; parentId?: string }> = []
    return {
      inserted,
      store: {
        insertTemplateArtifact: vi.fn(async (_documentId: string, artifact: { kind: string; parentId?: string }) => {
          inserted.push(artifact)
          return `id-${inserted.length}`
        }),
      } as unknown as KnowledgeStore,
    }
  }

  it('persists document template, questions, and per-question templates', async () => {
    const { store, inserted } = fakeStore()
    const embedding = { dimensions: 4, embed: vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0, 0, 0])) }
    const replies = [
      JSON.stringify(metadata),
      JSON.stringify({ title: 'T' }),
      JSON.stringify({ questions: [question, question] }),
      JSON.stringify(variantTemplate),
      JSON.stringify(variantTemplate),
    ]
    const summary = await runTemplatePipeline(
      { caller: createLlmCaller(llmWith(replies) as never, { provider: 'p', model: 'm' }), embedding: embedding as never, store },
      config,
      { documentId: 'd1', title: '真题', blocks: [{ kind: 'text', text: '内容' }] },
    )
    expect(summary.questionCount).toBe(1)
    expect(summary.questionTemplateCount).toBe(1)
    expect(inserted.map(entry => entry.kind)).toEqual(['document_template', 'question', 'question_template'])
  })

  it('isolates a per-question failure and counts it', async () => {
    const { store } = fakeStore()
    const embedding = { dimensions: 4, embed: vi.fn(async (texts: readonly string[]) => texts.map(() => [1, 0, 0, 0])) }
    const replies = [
      JSON.stringify(metadata),
      JSON.stringify({ title: 'T' }),
      JSON.stringify({ questions: [question] }),
      '不是 JSON',
      '仍然不是 JSON',
    ]
    const summary = await runTemplatePipeline(
      { caller: createLlmCaller(llmWith(replies) as never, { provider: 'p', model: 'm' }), embedding: embedding as never, store },
      config,
      { documentId: 'd1', title: '真题', blocks: [{ kind: 'text', text: '内容' }] },
    )
    expect(summary.questionCount).toBe(1)
    expect(summary.questionTemplateCount).toBe(0)
    expect(summary.failedQuestions).toBe(1)
  })
})
