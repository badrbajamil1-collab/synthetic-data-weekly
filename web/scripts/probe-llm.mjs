// One-off probe: verifies the makeModel() call profile against the real
// OpenRouter model without running the whole pipeline. Run from web/: node scripts/probe-llm.mjs
import { readFileSync } from 'node:fs'
import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'

const vars = {}
for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
  const index = line.indexOf('=')
  if (index > 0) vars[line.slice(0, index)] = line.slice(index + 1)
}

const model = new ChatOpenAI({
  model: vars.OPENROUTER_MODEL,
  apiKey: vars.OPENROUTER_API_KEY,
  temperature: 0.2,
  maxTokens: 2000,
  maxRetries: 0,
  timeout: 180000,
  configuration: { baseURL: 'https://openrouter.ai/api/v1' },
  modelKwargs: { reasoning: { effort: 'low', exclude: true } },
})

const system = `You write short, plain summaries for a research digest.
Use ONLY the TEXT provided. Never invent numbers, names, organisations or dates.
No hype. Say what the work is and what it shows, in 2-3 sentences.
Reply with ONLY JSON: {"summary": "..."}`

const user = `TEXT:
Synthetic data generation creates artificial datasets that mimic real ones while
controlling privacy leakage. A new benchmark measures how downstream model
accuracy degrades as the privacy budget tightens across 12 tabular datasets,
showing accuracy falls below 40 percent of the real-data baseline at the strictest
budgets.

TITLE: A privacy-utility benchmark for tabular synthesis
LENGTH: 2-3 sentences.`

const started = Date.now()
const response = await model.invoke([new SystemMessage(system), new HumanMessage(user)])
const elapsed = Date.now() - started
const text = typeof response.content === 'string' ? response.content : response.content.map((part) => part.text ?? '').join('')
console.log(`latency_ms=${elapsed}`)
console.log(`usage=${JSON.stringify(response.usage_metadata ?? response.response_metadata?.tokenUsage ?? null)}`)
console.log(`raw=${text.slice(0, 400)}`)
const start = Math.min(...[text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0))
const end = start >= 0 ? (text[start] === '[' ? text.lastIndexOf(']') : text.lastIndexOf('}')) : -1
try {
  const parsed = JSON.parse(text.slice(start, end + 1))
  console.log(`parsed=ok summary="${parsed.summary ?? JSON.stringify(parsed).slice(0, 200)}"`)
  process.exit(0)
} catch (error) {
  console.log(`parsed=FAILED (${error.message})`)
  process.exit(1)
}
