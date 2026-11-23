import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

export interface LlmEnv {
  OPENROUTER_API_KEY: string
  OPENROUTER_MODEL: string
  OPENROUTER_FALLBACK_MODELS?: string
}

export const DEFAULT_FALLBACK_MODELS = [
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-31b-it:free',
] as const

export function candidateModels(env: Pick<LlmEnv, 'OPENROUTER_MODEL' | 'OPENROUTER_FALLBACK_MODELS'>): string[] {
  const fallbacks =
    env.OPENROUTER_FALLBACK_MODELS === undefined
      ? [...DEFAULT_FALLBACK_MODELS]
      : env.OPENROUTER_FALLBACK_MODELS.split(',')
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [env.OPENROUTER_MODEL, ...fallbacks]) {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function isFreeDailyQuotaError(error: unknown): boolean {
  const parts: string[] = []
  if (error instanceof Error) parts.push(error.message)
  if (error && typeof error === 'object') {
    const obj = error as { message?: unknown; error?: { message?: unknown } }
    if (typeof obj.message === 'string') parts.push(obj.message)
    if (typeof obj.error?.message === 'string') parts.push(obj.error.message)
  }
  parts.push(String(error ?? ''))
  return parts.join(' ').toLowerCase().includes('free-models-per-day')
}

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const obj = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } }
  for (const raw of [obj.status, obj.statusCode, obj.response?.status]) {
    if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  }
  return null
}

// Call profile mirrors the verified Python setup in src/synthetic_data/llm.py:
// this free reasoning model spends its output budget on hidden reasoning, so
// every call asks OpenRouter for low-effort, excluded reasoning (modelKwargs),
// gets the 2000-token budget the Python side verified, a 180s timeout, and no
// SDK retries (an identical repeat call just burns its budget again).
export function makeModel(env: LlmEnv, maxTokens = 2000, temperature = 0): ChatOpenAI {
  return new ChatOpenAI({
    model: env.OPENROUTER_MODEL,
    apiKey: env.OPENROUTER_API_KEY,
    temperature,
    maxTokens,
    maxRetries: 0,
    timeout: 180000,
    configuration: { baseURL: 'https://openrouter.ai/api/v1' },
    modelKwargs: { reasoning: { effort: 'low', exclude: true } },
  })
}

export async function ask(model: ChatOpenAI, system: string, user: string): Promise<string> {
  const response = await model.invoke([new SystemMessage(system), new HumanMessage(user)])
  return typeof response.content === 'string'
    ? response.content
    : response.content.map((part) => ('text' in part ? part.text : '')).join('')
}

export async function askWithFallback(
  env: LlmEnv,
  system: string,
  user: string,
  options?: {
    maxTokens?: number
    temperature?: number
    invokeModel?: (modelName: string, system: string, user: string) => Promise<string>
  },
): Promise<{ content: string; model: string }> {
  const models = candidateModels(env)
  if (models.length === 0) {
    throw new Error('No OpenRouter model configured')
  }

  const maxTokens = options?.maxTokens ?? 2000
  const temperature = options?.temperature ?? 0
  let skipFreeModels = false
  let lastError: Error | null = null

  for (const modelName of models) {
    if (skipFreeModels && modelName.endsWith(':free')) continue
    try {
      const content = options?.invokeModel
        ? await options.invokeModel(modelName, system, user)
        : await ask(
            makeModel({ ...env, OPENROUTER_MODEL: modelName }, maxTokens, temperature),
            system,
            user,
          )
      if (content.trim().length > 0) {
        return { content, model: modelName }
      }
      lastError = new Error(`${modelName} returned empty output`)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      lastError = err
      const status = errorStatusCode(error)
      if (status === 401 || status === 403) {
        throw err
      }
      if (isFreeDailyQuotaError(error)) {
        skipFreeModels = true
      }
    }
  }

  throw lastError ?? new Error('LLM returned empty output across all candidate models')
}

export function parseJson<T>(raw: string): T | null {
  const start = Math.min(...[raw.indexOf('['), raw.indexOf('{')].filter((i) => i >= 0))
  if (!Number.isFinite(start)) return null
  const open = raw[start]
  const close = open === '[' ? raw.lastIndexOf(']') : raw.lastIndexOf('}')
  if (close < start) return null
  try {
    return JSON.parse(raw.slice(start, close + 1)) as T
  } catch {
    return null
  }
}
