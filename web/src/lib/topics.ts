import { topicsFor, type Taggable } from './feed.ts'

export type TopicKind = 'topic' | 'source'

export interface TopicFollow {
  kind: TopicKind
  value: string
}

export type { Taggable }

/** kind first, then value — the same order the D1 endpoint answers in. */
export function sortFollows(follows: TopicFollow[]): TopicFollow[] {
  return [...follows].sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
}

/**
 * An item is in my feed iff any of its topic labels is followed as a topic,
 * or its source is followed as a source (spec `2026-11-06-pages-and-feed-design.md`).
 */
export function matchesFollows(item: Pick<ReportLike, 'source'> & Taggable, follows: TopicFollow[]): boolean {
  return follows.some((follow) =>
    follow.kind === 'source'
      ? item.source === follow.value
      : topicsFor(item).includes(follow.value),
  )
}

type ReportLike = { source: string }

export interface ScoreBand {
  label: '8–10' | '5–7' | '1–4'
  count: number
}

function bandLabel(value: number): ScoreBand['label'] {
  if (value >= 8) return '8–10'
  if (value >= 5) return '5–7'
  return '1–4'
}

/** Groups importance values into the three fixed bands; nulls are skipped, never invented. */
export function scoreBands(scores: Array<number | null | undefined>): ScoreBand[] {
  const bands: ScoreBand[] = [
    { label: '8–10', count: 0 },
    { label: '5–7', count: 0 },
    { label: '1–4', count: 0 },
  ]
  for (const raw of scores) {
    if (raw === null || raw === undefined) continue
    const band = bands.find((candidate) => candidate.label === bandLabel(raw))
    if (band) band.count += 1
  }
  return bands
}

export function sourceCounts(items: Array<{ source: string }>): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.source, (counts.get(item.source) ?? 0) + 1)
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function topicCounts(items: Taggable[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const label of topicsFor(item)) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
