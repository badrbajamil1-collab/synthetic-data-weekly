/** Decide whether a ranking is good enough to publish.

Pure and dependency-free so it can be exercised without a Worker, D1 or a model.
The Worker pipeline writes straight into D1, so a failed ranking must be
rejected *before* any INSERT: otherwise a quota outage silently replaces a good
week with a report where every item is "Not scored by the model" at score 1.
*/

export const MAX_UNSCORED_RATIO = 0.10

const FALLBACK_PREFIX = 'Not scored by the model'

export interface RankingHealthInput {
  scored: Array<{ reason: string }>
  failedBatches: number
  totalBatches: number
}

export interface RankingHealth {
  publishable: boolean
  reason: string
}

export function rankingHealth(stats: RankingHealthInput): RankingHealth {
  const total = stats.scored.length
  if (total === 0) {
    return { publishable: false, reason: 'ranking produced no rows' }
  }
  if (stats.totalBatches > 0 && stats.failedBatches === stats.totalBatches) {
    return {
      publishable: false,
      reason: `all ${stats.totalBatches} score batches got no model output`,
    }
  }
  const unscored = stats.scored.filter((item) =>
    (item.reason || '').startsWith(FALLBACK_PREFIX),
  ).length
  const ratio = unscored / total
  if (ratio > MAX_UNSCORED_RATIO) {
    return {
      publishable: false,
      reason: `${unscored}/${total} items unscored (limit ${MAX_UNSCORED_RATIO})`,
    }
  }
  return { publishable: true, reason: '' }
}
