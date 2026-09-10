/**
 * The template pipeline: document-level metadata distillation, one document
 * question template, windowed question extraction, and a per-question
 * variant template with a reusable generation prompt. Every model reply is
 * JSON-extracted and validated at this boundary; malformed replies retry once
 * before failing, and per-question failures never fail the document.
 * @module @deepseek-ai/dsh-workbench-knowledge/template-pipeline
 */

import type { Difficulty, KnowledgeEmbedding, KnowledgeStore, TemplateArtifactRecord, TemplateMetadata } from './types.ts'
import { DIFFICULTIES } from './difficulties.ts'
import { extractJson, type LlmCaller } from './llm.ts'

/** Bounds for the template pipeline. */
export interface TemplatePipelineConfig {
  readonly maxDocumentChars: number
  readonly maxQuestions: number
  readonly extractionWindowChars: number
  readonly questionTemplateConcurrency: number
}

/** Pipeline inputs shared by every step. */
export interface TemplatePipelineDeps {
  readonly caller: LlmCaller
  readonly embedding: KnowledgeEmbedding
  readonly store: KnowledgeStore
}

const MAX_EMBED_CHARS = 6_000

/** Embed one text and fail loudly when the endpoint returns a misaligned response. */
async function embedOne(
  embedding: KnowledgeEmbedding,
  text: string,
  signal?: AbortSignal,
): Promise<readonly number[]> {
  const [vector] = await embedding.embed([text], signal)
  if (vector === undefined) throw new Error('workbench-knowledge: the embedding endpoint returned no vector')
  return vector
}

const METADATA_SYSTEM = '你是文档元数据提炼助手。只输出一个 JSON 对象，不要输出任何其它文字、解释或代码块标记。'

const METADATA_PROMPT = (title: string, content: string): string =>
  '请根据文档名称和文档内容提炼精简的元数据，用于后续检索。只输出 JSON 对象：\n'
  + '{"subject":"学科或领域","topic":"主题或章节","questionType":"主要题型","knowledgePoints":["考点"],"keywords":["检索关键词"],"gradeLevel":"年级(可选)","year":"年份(可选)","source":"来源(可选)"}\n'
  + '前五项必须给出；gradeLevel、year、source 仅当文档名称或内容明确提到时给出，否则省略该字段。\n\n'
  + `文档名称：${title}\n\n文档内容：\n${content}`

const DOC_TEMPLATE_SYSTEM = '你是出题模板设计专家。只输出一个 JSON 对象，不要输出任何其它文字。'

const DOC_TEMPLATE_PROMPT = (title: string, outline: string, content: string): string =>
  '请根据文档提炼一份出题模板。只输出 JSON 对象：\n'
  + '{"title":"文档标题","questionTypes":[{"type":"题型","proportion":"占比或数量","requirements":"命题要求"}],"knowledgePoints":["考点"],"difficultyDistribution":"按 简单/普通/困难/地狱/噩梦 五档描述难度分布","generationRules":["出题规则"],"sampleQuestions":[{"stem":"示例题干","answerOutline":"答案要点"}]}\n'
  + 'sampleQuestions 最多 5 个；generationRules 给出可复用的命题约束。\n\n'
  + `文档标题：${title}\n\n结构大纲：\n${outline}\n\n文档内容：\n${content}`

const QUESTION_SYSTEM = '你是题目抽取助手。只输出一个 JSON 对象，不要输出任何其它文字。'

const QUESTION_PROMPT = (content: string): string =>
  '从以下文档片段中抽取已经存在的题目（不要自己编题）。只输出 JSON 对象：\n'
  + '{"questions":[{"stem":"题干","options":["选项"],"answer":"答案","analysis":"解析","knowledgePoints":["考点"],"sourceLocation":"出处(章节/页码)","difficulty":"easy|normal|hard|hell|nightmare"}]}\n'
  + 'difficulty 必须恰好是 easy、normal、hard、hell、nightmare 之一（依次对应 简单/普通/困难/地狱/噩梦）。options 仅选择题需要；answer、analysis 文档中没有就省略。片段中没有题目时输出 {"questions":[]}。\n\n文档片段：\n'
  + content

const VARIANT_TEMPLATE_SYSTEM = '你是变式出题模板设计专家。只输出一个 JSON 对象，不要输出任何其它文字。'

const VARIANT_TEMPLATE_PROMPT = (stem: string, extra: string, metadata: string): string =>
  '针对下面这道题，设计一份可复用的变式出题模板，用于以后批量生成同型变式题。只输出 JSON 对象：\n'
  + '{"pattern":"题型结构描述","variables":[{"name":"变量名","description":"说明","valueRange":"取值范围"}],"constraints":["不变量/约束"],"solutionStrategy":"解法要点","knowledgePoints":["考点"],"difficulty":"easy|normal|hard|hell|nightmare","generationPrompt":"可直接复用的变式生成指令文本，其中用 {difficulty} 作为目标难度占位符","exampleVariant":{"stem":"示例变式题干","answerOutline":"答案要点"}}\n'
  + 'difficulty 必须恰好是 easy、normal、hard、hell、nightmare 之一，与原题难度相当或按原题评定；exampleVariant 可省略；variables 描述哪些要素可以改变、constraints 描述哪些要素必须保持。\n\n'
  + `原题：${stem}\n${extra}\n\n文档元数据：${metadata}`

const VARIANT_GENERATION_SYSTEM = '你是出题助手。只输出一个 JSON 对象，不要输出任何其它文字。'

const VARIANT_GENERATION_PROMPT = (count: number, difficulty: string, prompt: string, stem: string): string =>
  `按照以下出题模板生成 ${count} 道目标难度为「${difficulty}」的变式题。只输出 JSON 对象：\n`
  + '{"variants":[{"stem":"题干","answerOutline":"答案要点","difficulty":"easy|normal|hard|hell|nightmare"}]}\n'
  + '每道变式题的 difficulty 必须恰好是 easy、normal、hard、hell、nightmare 之一，且与目标难度一致。\n\n出题模板指令：\n'
  + prompt + '\n\n原题（供参考，不要原样输出）：\n' + stem

/** Validate a difficulty value against the five fixed levels. */
function asDifficulty(value: unknown): Difficulty {
  if (typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value)) return value as Difficulty
  throw new Error(`difficulty "${String(value)}" is not one of ${DIFFICULTIES.join('|')}`)
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new Error(`field "${field}" must be a string array`)
  }
  return value as string[]
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`field "${field}" must be a non-empty string`)
  return value
}

/**
 * Validate one distilled metadata object.
 * @param raw - the untrusted model JSON.
 * @returns the validated metadata.
 * @throws when a required field is missing or empty.
 */
export function validateMetadata(raw: unknown): TemplateMetadata {
  if (typeof raw !== 'object' || raw === null) throw new Error('metadata must be a JSON object')
  const record = raw as Record<string, unknown>
  const metadata: TemplateMetadata = {
    subject: asString(record.subject, 'subject'),
    topic: asString(record.topic, 'topic'),
    questionType: asString(record.questionType, 'questionType'),
    knowledgePoints: asStringArray(record.knowledgePoints, 'knowledgePoints'),
    keywords: asStringArray(record.keywords, 'keywords'),
  }
  for (const field of ['gradeLevel', 'year', 'source'] as const) {
    const value = record[field]
    if (typeof value === 'string' && value.trim().length > 0) metadata[field] = value
  }
  return metadata
}

/** Complete-once helper: run the call, and on any failure run it exactly one more time. */
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (first) {
    try {
      return await run()
    } catch {
      throw first
    }
  }
}

/** Document-level pipeline results (already persisted by the run). */
export interface TemplatePipelineSummary {
  readonly questionCount: number
  readonly questionTemplateCount: number
  readonly failedQuestions: number
}

/**
 * Run the full template pipeline for one parsed document and persist every
 * artifact. Throws only for document-level failures (metadata, document
 * template); per-question failures are isolated and counted.
 * @param deps - the model caller, embedding, and store the pipeline uses.
 * @param config - template pipeline bounds.
 * @param document - the parsed document's identity, title, and blocks.
 * @param signal - cancellation for the whole pipeline.
 * @returns per-kind counts including isolated failures.
 */
export async function runTemplatePipeline(
  deps: TemplatePipelineDeps,
  config: TemplatePipelineConfig,
  document: {
    readonly documentId: string
    readonly title: string
    readonly blocks: readonly { readonly kind: string; readonly level?: number; readonly text: string }[]
  },
  signal?: AbortSignal,
): Promise<TemplatePipelineSummary> {
  const fullText = document.blocks.map(block => block.text).join('\n\n').slice(0, config.maxDocumentChars)
  const outline = document.blocks
    .filter(block => block.kind === 'heading')
    .map(block => `${'  '.repeat((block.level ?? 1) - 1)}- ${block.text}`)
    .join('\n')

  const metadata = await withRetry(async () => {
    signal?.throwIfAborted()
    return validateMetadata(extractJson(await deps.caller.complete({
      system: METADATA_SYSTEM,
      user: METADATA_PROMPT(document.title, fullText),
      maxTokens: 800,
      ...(signal === undefined ? {} : { signal }),
    })))
  })

  const docTemplate = await withRetry(async () => {
    signal?.throwIfAborted()
    return extractJson<Record<string, unknown>>(await deps.caller.complete({
      system: DOC_TEMPLATE_SYSTEM,
      user: DOC_TEMPLATE_PROMPT(document.title, outline, fullText),
      maxTokens: 2_000,
      ...(signal === undefined ? {} : { signal }),
    }))
  })
  const metadataSummary = JSON.stringify(metadata)
  await deps.store.insertTemplateArtifact(document.documentId, {
    kind: 'document_template',
    title: typeof docTemplate.title === 'string' ? docTemplate.title : document.title,
    payload: docTemplate,
    metadata,
    embedding: await embedOne(deps.embedding, embedTextOf(metadata, JSON.stringify(docTemplate)), signal),
  })

  const questions = await extractQuestions(deps, config, fullText, signal)
  const questionIds = new Map<number, string>()
  for (const [index, question] of questions.entries()) {
    questionIds.set(index, await deps.store.insertTemplateArtifact(document.documentId, {
      kind: 'question',
      title: question.stem.slice(0, 120),
      payload: question,
      difficulty: question.difficulty,
      metadata,
      embedding: await embedOne(deps.embedding, question.stem.slice(0, MAX_EMBED_CHARS), signal),
    }))
  }

  let questionTemplateCount = 0
  let failedQuestions = 0
  const outcomes = await mapWithConcurrency(questions, config.questionTemplateConcurrency, async (question, index) => {
    signal?.throwIfAborted()
    const extra = typeof question.answer === 'string' ? `参考答案：${question.answer}` : ''
    const raw = await withRetry(async () => extractJson<Record<string, unknown>>(await deps.caller.complete({
      system: VARIANT_TEMPLATE_SYSTEM,
      user: VARIANT_TEMPLATE_PROMPT(question.stem, extra, metadataSummary),
      maxTokens: 1_500,
      ...(signal === undefined ? {} : { signal }),
    })))
    const template = validateVariantTemplate(raw)
    const questionArtifactId = questionIds.get(index)
    const artifactId = await deps.store.insertTemplateArtifact(document.documentId, {
      kind: 'question_template',
      ...(questionArtifactId === undefined ? {} : { parentId: questionArtifactId }),
      title: template.pattern.slice(0, 120),
      payload: { ...template, sourceStem: question.stem },
      difficulty: template.difficulty,
      metadata: mergeMetadata(metadata, question),
      embedding: await embedOne(deps.embedding, embedTextOf(mergeMetadata(metadata, question), template.pattern + ' ' + template.constraints.join(';') + ' ' + template.knowledgePoints.join(';')), signal),
    })
    return artifactId
  })
  for (const outcome of outcomes) {
    if (outcome === undefined) failedQuestions += 1
    else questionTemplateCount += 1
  }
  return { questionCount: questions.length, questionTemplateCount, failedQuestions }
}

/** Windowed question extraction with dedup and cap. */
async function extractQuestions(
  deps: TemplatePipelineDeps,
  config: TemplatePipelineConfig,
  fullText: string,
  signal?: AbortSignal,
): Promise<ExtractedQuestion[]> {
  const questions: ExtractedQuestion[] = []
  const seen = new Set<string>()
  for (let start = 0; start < fullText.length && questions.length < config.maxQuestions; start += config.extractionWindowChars) {
    signal?.throwIfAborted()
    const window = fullText.slice(start, start + config.extractionWindowChars)
    if (window.trim().length === 0) break
    const batch = await withRetry(async () => extractJson<{ questions?: unknown }>(await deps.caller.complete({
      system: QUESTION_SYSTEM,
      user: QUESTION_PROMPT(window),
      maxTokens: 2_000,
      ...(signal === undefined ? {} : { signal }),
    })))
    if (!Array.isArray(batch.questions)) continue
    for (const raw of batch.questions) {
      if (questions.length >= config.maxQuestions) break
      try {
        const question = validateQuestion(raw)
        const key = question.stem.replace(/\s+/g, '')
        if (seen.has(key)) continue
        seen.add(key)
        questions.push(question)
      } catch {
        // An invalid question entry is skipped; extraction continues.
      }
    }
  }
  return questions
}

/** One question extracted verbatim from a document, with its assessed difficulty. */
export interface ExtractedQuestion {
  readonly stem: string
  readonly options?: readonly string[]
  readonly answer?: string
  readonly analysis?: string
  readonly knowledgePoints: readonly string[]
  readonly sourceLocation: string
  readonly difficulty: Difficulty
}

/**
 * Validate one extracted question.
 * @param raw - the untrusted model JSON.
 * @returns the validated question.
 * @throws when a field violates the contract or the difficulty enum.
 */
export function validateQuestion(raw: unknown): ExtractedQuestion {
  if (typeof raw !== 'object' || raw === null) throw new Error('question must be an object')
  const record = raw as Record<string, unknown>
  const answer = typeof record.answer === 'string' && record.answer.trim().length > 0 ? record.answer : undefined
  const analysis = typeof record.analysis === 'string' && record.analysis.trim().length > 0 ? record.analysis : undefined
  return {
    stem: asString(record.stem, 'stem'),
    knowledgePoints: asStringArray(record.knowledgePoints ?? [], 'knowledgePoints'),
    sourceLocation: typeof record.sourceLocation === 'string' ? record.sourceLocation : '',
    difficulty: asDifficulty(record.difficulty),
    ...(Array.isArray(record.options) && record.options.every(entry => typeof entry === 'string')
      ? { options: record.options as string[] } : {}),
    ...(answer === undefined ? {} : { answer }),
    ...(analysis === undefined ? {} : { analysis }),
  }
}

/** The reusable, generation-ready template distilled from one question. */
export interface QuestionVariantTemplate {
  readonly pattern: string
  readonly variables: readonly { readonly name: string; readonly description: string; readonly valueRange: string }[]
  readonly constraints: readonly string[]
  readonly solutionStrategy: string
  readonly knowledgePoints: readonly string[]
  readonly difficulty: Difficulty
  readonly generationPrompt: string
  readonly exampleVariant?: { readonly stem: string; readonly answerOutline?: string }
}

/**
 * Validate one per-question variant template.
 * @param raw - the untrusted model JSON.
 * @returns the validated template.
 * @throws when a field violates the contract or the difficulty enum.
 */
export function validateVariantTemplate(raw: unknown): QuestionVariantTemplate {
  if (typeof raw !== 'object' || raw === null) throw new Error('variant template must be an object')
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.variables)) throw new Error('field "variables" must be an array')
  return {
    pattern: asString(record.pattern, 'pattern'),
    variables: record.variables.map((entry) => {
      const variable = entry as Record<string, unknown>
      return {
        name: asString(variable.name, 'variables.name'),
        description: typeof variable.description === 'string' ? variable.description : '',
        valueRange: typeof variable.valueRange === 'string' ? variable.valueRange : '',
      }
    }),
    constraints: asStringArray(record.constraints ?? [], 'constraints'),
    solutionStrategy: typeof record.solutionStrategy === 'string' ? record.solutionStrategy : '',
    knowledgePoints: asStringArray(record.knowledgePoints ?? [], 'knowledgePoints'),
    difficulty: asDifficulty(record.difficulty),
    generationPrompt: asString(record.generationPrompt, 'generationPrompt'),
  }
}

/** Compose the embedding text for one template artifact. */
function embedTextOf(metadata: TemplateMetadata, body: string): string {
  return [
    metadata.subject,
    metadata.topic,
    metadata.questionType,
    metadata.gradeLevel ?? '',
    metadata.year ?? '',
    metadata.source ?? '',
    metadata.knowledgePoints.join(' '),
    metadata.keywords.join(' '),
    body,
  ].join(' ').slice(0, MAX_EMBED_CHARS)
}

/** Inherit document metadata and refine per-question fields. */
function mergeMetadata(metadata: TemplateMetadata, question: ExtractedQuestion): TemplateMetadata {
  return {
    ...metadata,
    knowledgePoints: question.knowledgePoints.length > 0 ? [...question.knowledgePoints] : metadata.knowledgePoints,
  }
}

/** Map with bounded concurrency; failures resolve to `undefined`. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<Array<R | undefined>> {
  const results = new Array<R | undefined>(items.length).fill(undefined)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item === undefined) continue
      try {
        results[index] = await run(item, index)
      } catch {
        // Isolated failure: the slot stays undefined.
      }
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Generate variants from one stored question template and archive them.
 * @param deps - the model caller, embedding, and store.
 * @param template - the stored `question_template` artifact.
 * @param request - variant count (capped by config) and optional target difficulty.
 * @returns the ids of the created variant artifacts.
 */
export async function generateVariants(
  deps: Pick<TemplatePipelineDeps, 'caller' | 'embedding' | 'store'>,
  template: TemplateArtifactRecord,
  request: { readonly count: number; readonly difficulty?: Difficulty; readonly signal?: AbortSignal },
): Promise<string[]> {
  const payload = template.payload as { sourceStem?: string; generationPrompt?: string }
  const generationPrompt = typeof payload.generationPrompt === 'string' ? payload.generationPrompt : ''
  if (generationPrompt.length === 0) throw new Error('workbench-knowledge: this artifact has no generation prompt')
  const sourceStem = typeof payload.sourceStem === 'string' ? payload.sourceStem : ''
  const difficulty = request.difficulty ?? template.difficulty ?? 'normal'
  const filled = generationPrompt.replaceAll('{difficulty}', difficulty)
  const raw = await withRetry(async () => extractJson<{ variants?: unknown }>(await deps.caller.complete({
    system: VARIANT_GENERATION_SYSTEM,
    user: VARIANT_GENERATION_PROMPT(request.count, difficulty, filled, sourceStem),
    maxTokens: 2_000,
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  })))
  if (!Array.isArray(raw.variants)) throw new Error('workbench-knowledge: variant generation returned no variants array')
  const created: string[] = []
  for (const entry of raw.variants.slice(0, request.count)) {
    const record = entry as Record<string, unknown>
    const stem = asString(record.stem, 'variants.stem')
    const variantDifficulty = record.difficulty === undefined ? difficulty : asDifficulty(record.difficulty)
    created.push(await deps.store.insertTemplateArtifact(template.documentId, {
      kind: 'variant',
      parentId: template.artifactId,
      title: stem.slice(0, 120),
      payload: {
        stem,
        ...(typeof record.answerOutline === 'string' ? { answerOutline: record.answerOutline } : {}),
      },
      difficulty: variantDifficulty,
      ...(template.metadata === undefined ? {} : { metadata: template.metadata }),
      embedding: await embedOne(deps.embedding, stem.slice(0, MAX_EMBED_CHARS), request.signal),
    }))
  }
  return created
}
