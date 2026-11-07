import type { RawItem } from './sources.ts'
import { ask, makeModel, parseJson, type LlmEnv } from './llm.ts'

export interface Scored extends RawItem {
  score: number
  well7_fit: number
  reason: string
}

const BATCH = 15

const SYSTEM = `You score research items for a weekly digest about synthetic data
(tabular synthesis, differential privacy, synthetic time series, synthetic training data).
Score each item 1-10 for relevance and substance.
Also rate well7_fit 1-10: how useful this is to Well7 Research Lab (privacy-first tabular and time-series synthetic data).
Penalise repos and posts that only mention the topic in passing; reward papers, real tools and concrete results.
Reply with ONLY a JSON array: [{"id": <number>, "score": <1-10>, "well7_fit": <1-10>, "reason": "<under 160 chars>"}]`

export interface RankStats {
  scored: Scored[]
  failedBatches: number
  totalBatches: number
}

export async function rankItems(items: RawItem[], env: LlmEnv): Promise<RankStats> {
  const model = makeModel(env, 2000)
  const batches: RawItem[][] = []
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH))

  // All score batches go out at once. Each call takes 60-150s on the free
  // reasoning model, and Workers cron runs have a 15-minute wall-clock limit,
  // so serialising waves of 3 does not fit. Free-model rate limits (20 req/min)
  // still leave this far below the cap.
  const results = await Promise.all(batches.map((batch) => scoreBatch(model, batch)))
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

async function scoreBatch(model: ReturnType<typeof makeModel>, batch: RawItem[]): Promise<BatchOutcome> {
  const list = batch
    .map((item, index) => `${index}. ${item.title} | ${item.source} | ${item.snippet.slice(0, 300)}`)
    .join('\n')
  let rows: Array<{ id: number; score?: number; well7_fit?: number; reason: string }> | null = null
  try {
    const raw = await ask(model, SYSTEM, `ITEMS:\n${list}`)
    rows = parseJson<Array<{ id: number; score?: number; well7_fit?: number; reason: string }>>(raw)
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
    const rawScore = Number(row.score ?? row.well7_fit)
    const rawFit = Number(row.well7_fit ?? row.score)
    const score = Math.round(rawScore)
    const fit = Math.round(rawFit)
    if (
      Number.isInteger(score) && score >= 1 && score <= 10 &&
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
