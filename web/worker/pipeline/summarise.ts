import { ask, makeModel, parseJson, type LlmEnv } from './llm.ts'
import { stripHtml, type RawItem } from './sources.ts'
import type { Scored } from './rank.ts'

export type Guard = 'passed' | 'repaired' | 'extractive' | 'skipped'

export interface Summary {
  summary: string
  origin: 'full text' | 'snippet only'
  guard: Guard
}

const NUMBER = /(?<![\w.])\d+(?:[.,]\d+)*/g

export function numbersIn(text: string): string[] {
  return [...(text.match(NUMBER) ?? [])].map((n) => n.replace(/,/g, ''))
}

export function unsupportedNumbers(summary: string, source: string): string[] {
  const available = new Set(numbersIn(source))
  return numbersIn(summary).filter((n) => !available.has(n))
}

export function extractive(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30)
  return sentences.slice(0, 3).join(' ').slice(0, 420)
}

export async function fetchArticleText(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'synthetic-data-weekly/1.0', Accept: 'text/html,text/plain' },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!response.ok) return ''
    const type = response.headers.get('content-type') ?? ''
    if (!type.includes('text')) return ''
    return stripHtml(await response.text()).slice(0, 6000)
  } catch {
    return ''
  }
}

const SYSTEM = `You write short, plain summaries for a research digest.
Use ONLY the TEXT provided. Never invent numbers, names, organisations or dates.
No hype. Say what the work is and what it shows, in 2-3 sentences.
Reply with ONLY JSON: {"summary": "..."}`

export async function summarise(item: RawItem, env: LlmEnv, oneLine: boolean): Promise<Summary> {
  const fullText = await fetchArticleText(item.url)
  const text = fullText.length > 200 ? fullText : item.snippet
  const origin = fullText.length > 200 ? 'full text' : 'snippet only'
  const source = `${item.title}\n${text}`
  if (!text.trim()) {
    return { summary: 'No text was available to summarise; see the link.', origin, guard: 'skipped' }
  }

  // 2000 maxTokens, 180s timeout: see llm.ts. A smaller budget made this model
  // emit truncated JSON that parsed as nothing (the Python side learned the
  // same lesson; config.yaml says "700 was too low").
  const model = makeModel(env, 2000, 0.2)
  const length = oneLine ? 'One sentence, under 200 characters.' : '2-3 sentences.'
  let rejected: string[] = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const repair = rejected.length
      ? `\nYour previous draft used numbers not present in the TEXT: ${rejected.join(', ')}. Remove them.`
      : ''
    try {
      const raw = await ask(model, SYSTEM, `TEXT:\n${text}\n\nTITLE: ${item.title}\nLENGTH: ${length}${repair}`)
      const parsed = parseJson<{ summary?: string }>(raw)
      const candidate = (parsed && !Array.isArray(parsed) ? parsed.summary : undefined)?.trim()
      if (!candidate) continue
      rejected = unsupportedNumbers(candidate, source)
      if (rejected.length === 0) {
        return { summary: candidate, origin, guard: attempt === 0 ? 'passed' : 'repaired' }
      }
    } catch {
      break
    }
  }
  return { summary: extractive(text), origin, guard: 'extractive' }
}

export async function trend(picks: Array<{ title: string; summary: string }>, env: LlmEnv): Promise<string> {
  const material = picks.map((p) => `- ${p.title}: ${p.summary}`).join('\n')
  const fallback = `This week's picks cover ${picks.length} items across papers, tools and reporting.`
  if (!material) return fallback
  const model = makeModel(env, 2000, 0.2)
  const system = `Write ONE paragraph (3-4 sentences) describing what this week's picks say about
synthetic data, using only the material. No invented numbers. Reply with ONLY JSON: {"trend": "..."}`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await ask(model, system, `MATERIAL:\n${material}`)
      const parsed = parseJson<{ trend?: string }>(raw)
      const candidate = parsed && !Array.isArray(parsed) ? parsed.trend?.trim() : undefined
      if (candidate && unsupportedNumbers(candidate, material).length === 0) return candidate
    } catch {
      break
    }
  }
  return fallback
}

export interface SummariseStats {
  sections: Section[]
  fallbacks: number
}

export interface Section {
  section: 'top' | 'tool' | 'worth'
  item: Scored
  summary: Summary
}

export async function buildSections(ranked: Scored[], env: LlmEnv): Promise<SummariseStats> {
  const sorted = [...ranked].sort((a, b) => (b.well7_fit ?? 0) - (a.well7_fit ?? 0) || b.title.localeCompare(a.title))
  const picks = sorted.slice(0, 6)
  const rest = sorted.slice(6)
  const tools = rest.filter((item) => item.source === 'GitHub').slice(0, 5)
  const worth = rest.filter((item) => item.source !== 'GitHub').slice(0, 5)

  const plan: Array<{ section: Section['section']; item: Scored; oneLine: boolean }> = [
    ...picks.map((item) => ({ section: 'top' as const, item, oneLine: false })),
    ...tools.map((item) => ({ section: 'tool' as const, item, oneLine: true })),
    ...worth.map((item) => ({ section: 'worth' as const, item, oneLine: true })),
  ]

  const out: Section[] = []
  let fallbacks = 0
  // Waves of 6: at 60-150s per call this keeps a 16-call summarise stage around
  // 3 waves (well inside the 15-minute Workers cron wall limit) while staying
  // under the free model's 20 req/min cap.
  for (let i = 0; i < plan.length; i += 6) {
    const wave = plan.slice(i, i + 6)
    const results = await Promise.all(wave.map((p) => summarise(p.item, env, p.oneLine)))
    wave.forEach((p, index) => {
      const summary = results[index]
      if (summary.guard === 'extractive' || summary.guard === 'skipped') fallbacks += 1
      out.push({ section: p.section, item: p.item, summary })
    })
  }
  return { sections: out, fallbacks }
}
