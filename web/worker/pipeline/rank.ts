import type { RawItem } from './sources.ts'
import { askWithFallback, parseJson, type LlmEnv } from './llm.ts'

export interface Scored extends RawItem {
  score: number
  well7_fit: number
  reason: string
}

const BATCH = 15

const BASE_SYSTEM = `You score research items for a weekly digest about synthetic data
(tabular synthesis, differential privacy, synthetic time series, synthetic training data).
Rate each item 1-10 for relevance and substance ("score"), then 1-10 for Well7 fit ("well7_fit"): how useful this is to
Well7 Research Lab (privacy-first tabular and time-series synthetic data).
Penalise repos and posts that only mention the topic in passing; reward papers, real tools and concrete results.
Reply with ONLY a JSON array: [{"id": <number>, "score": <1-10>, "well7_fit": <1-10>, "reason": "<under 160 chars>"}]`

export interface RankStats {
  scored: Scored[]
  failedBatches: number
  totalBatches: number
}

export async function rankItems(items: RawItem[], env: LlmEnv, query = ''): Promise<RankStats> {
  if (items.length === 0) {
    return { scored: [], failedBatches: 0, totalBatches: 0 }
  }
  const batches: RawItem[][] = []
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))

  const systemPrompt = query.trim()
    ? `${BASE_SYSTEM}\nFocus topic requested by researcher: "${query.trim()}". Boost items directly addressing this topic.`
    : BASE_SYSTEM

  // All score batches go out at once. Each call takes 60-150s on the free
  // reasoning model, and Workers cron runs have a 15-minute wall-clock limit,
  // so serialising waves of 3 does not fit. Free-model rate limits (20 req/min)
  // still leave this far below the cap.
  const results = await Promise.all(batches.map((batch) => scoreBatch(env, batch, systemPrompt)))
  return {
    scored: results.flatMap((r) => r.rows),
    failedBatches: results.filter((r) => r.failed).length,
    totalBatches: batches.length,
  }
}

interface BatchOutcome {
  failed: boolean
  rows: Scored[]
}

async function scoreBatch(
  env: LlmEnv,
  batch: RawItem[],
  systemPrompt: string,
): Promise<BatchOutcome> {
  const list = batch
    .map((item, index) => `${index}. ${item.title} | ${item.source} | ${item.snippet.slice(0, 300)}`)
    .join('\n')
  let rows: Array<{ id: number; score?: number; well7_fit: number; reason: string }> | null = null
  try {
    // Match Python's verified 8000-token budget: hidden reasoning on Nemotron
    // exhausts 2000 tokens on 15-item batches and truncates JSON output.
    const { content: raw } = await askWithFallback(env, systemPrompt, `ITEMS:\n${list}`, {
      maxTokens: 8000,
      temperature: 0,
    })
    rows = parseJson<Array<{ id: number; score?: number; well7_fit: number; reason: string }>>(raw)
  } catch {
    rows = null
  }
  if (!rows) {
    return {
      failed: true,
      rows: batch.map((item) => ({
        ...item,
        score: 1,
        well7_fit: 1,
        reason: 'Not scored by the model; kept at the lowest band.',
      })),
    }
  }
  const byId = new Map<number, { score: number; well7_fit: number; reason: string }>()
  for (const row of rows) {
    const fit = Math.round(Number(row.well7_fit))
    const rawScore = row.score !== undefined ? Math.round(Number(row.score)) : fit
    const score = Number.isInteger(rawScore) && rawScore >= 1 && rawScore <= 10 ? rawScore : fit
    if (
      Number.isInteger(fit) && fit >= 1 && fit <= 10 &&
      typeof row.reason === 'string'
    ) {
      byId.set(Number(row.id), { score, well7_fit: fit, reason: row.reason.slice(0, 160) })
    }
  }
  return {
    failed: byId.size === 0,
    rows: batch.map((item, index) => {
      const hit = byId.get(index)
      return {
        ...item,
        score: hit?.score ?? 1,
        well7_fit: hit?.well7_fit ?? 1,
        reason: hit?.reason ?? 'Not scored by the model; kept at the lowest band.',
      }
    }),
  }
}
