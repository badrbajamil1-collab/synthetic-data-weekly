import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

export interface LlmEnv {
  OPENROUTER_API_KEY: string
  OPENROUTER_MODEL: string
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
