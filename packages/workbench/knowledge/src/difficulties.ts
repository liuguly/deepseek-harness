/**
 * The five fixed difficulty levels shared by prompts, validation, and UI
 * codes. Internal matching always uses these stable codes; localized labels
 * live in the browser locale dictionaries.
 * @module @deepseek-ai/dsh-workbench-knowledge/difficulties
 */

import type { Difficulty } from './types.ts'

/** The five fixed difficulty levels, easiest to hardest. */
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard', 'hell', 'nightmare'] as const
