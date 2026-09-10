/**
 * One-shot model calls for the knowledge pipelines: assembles text through
 * the harness model route (`ctx.llm.stream`), extracts JSON objects from the
 * reply, and retries malformed JSON once. The route is an explicit
 * composition choice — there is no deployment-wide default route service.
 * @module @deepseek-ai/dsh-workbench-knowledge/llm
 */

import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmRuntime, Message } from '@deepseek-ai/dsh-llm'

/** The model route one template pipeline runs on. */
export interface KnowledgeLlmRoute {
  readonly provider: string
  readonly model: string
}

/**
 * One-shot completion caller over the harness model route.
 * `system` is pinned per pipeline step; `user` carries the bounded input.
 */
export interface LlmCaller {
  /**
   * Run one completion over the configured route.
   * @param request - system instruction, bounded user input, output cap, and cancellation.
   * @returns the assembled reply text.
   */
  complete(request: {
    readonly system: string
    readonly user: string
    readonly maxTokens: number
    readonly signal?: AbortSignal
  }): Promise<string>
}

/**
 * Build a caller over the harness llm service. Requests carry no `purpose`
 * and no `sessionId`: both fields are optional on `GenerateOptions`, and the
 * `purpose` union is closed in the core package.
 * @param llm - the harness llm runtime.
 * @param route - explicit provider/model route for every pipeline call.
 * @returns the one-shot caller.
 */
export function createLlmCaller(llm: LlmRuntime, route: KnowledgeLlmRoute): LlmCaller {
  return {
    async complete({ system, user, maxTokens, signal }) {
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: user }],
        source: { kind: 'plugin', plugin: 'dsh-workbench-knowledge' },
      })]
      const options: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        messages,
        system,
        maxTokens,
        ...(signal === undefined ? {} : { signal }),
      }
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream(options)) {
        assembler.push(chunk)
      }
      const finish = assembler.finish
      if (finish.kind === 'error' || finish.kind === 'aborted') {
        throw new Error(`workbench-knowledge: model call failed: ${finish.failure.message}`)
      }
      if (finish.kind === 'max-tokens') {
        throw new Error('workbench-knowledge: model output reached maxTokens before completing the JSON reply')
      }
      if (finish.kind === 'tool-calls') {
        throw new Error('workbench-knowledge: model unexpectedly requested a tool call')
      }
      const text = assembler.blocks()
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (text.trim().length === 0) {
        throw new Error('workbench-knowledge: model produced no text')
      }
      return text
    },
  }
}

/**
 * Extract the first JSON value from a model reply, tolerating code fences and
 * surrounding prose.
 * @param text - raw model reply.
 * @returns the parsed JSON value.
 * @throws when no JSON object or array can be extracted.
 */
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidates = [fenced?.[1], text]
  for (const candidate of candidates) {
    if (candidate === undefined) continue
    const start = candidate.search(/[[{]/)
    if (start === -1) continue
    const opener = candidate[start]
    const closer = opener === '{' ? '}' : ']'
    const end = candidate.lastIndexOf(closer)
    if (end <= start) continue
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T
    } catch {
      // Try the next candidate window.
    }
  }
  throw new Error('workbench-knowledge: model reply contains no parseable JSON')
}
