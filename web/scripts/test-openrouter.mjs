import { ChatOpenAI } from '@langchain/openai'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load .env from repo root
const envPath = resolve(process.cwd(), '..', '.env')
const envText = readFileSync(envPath, 'utf8')
const env = {}
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim()
}

const apiKey = env.OPENROUTER_API_KEY
if (!apiKey) {
  console.error('OPENROUTER_API_KEY not found in .env')
  process.exit(1)
}
console.log('API key length:', apiKey.length)

const model = new ChatOpenAI({
  model: 'openai/gpt-4o-mini',
  apiKey: apiKey,
  configuration: {
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:5173',
      'X-Title': 'Synthetic Data Weekly',
    },
  },
  temperature: 0.2,
})

const prompt = 'In one sentence, what is synthetic data used for in machine learning?'
console.log('Prompt:', prompt)

const res = await model.invoke(prompt)
console.log('Response:', res.content)