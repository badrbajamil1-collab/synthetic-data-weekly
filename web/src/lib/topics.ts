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
      ? sameSource(item.source, follow.value)
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

/**
 * Counts by source, merged case-insensitively.
 *
 * `items.source` holds whichever label the collector wrote — "GitHub" from one
 * run, "github" from another — so grouping on the raw string split one source
 * into two rows, and starring one missed the other. The label kept for display
 * prefers the cased spelling ("GitHub" over "github").
 */
export function sourceCounts(items: Array<{ source: string }>): Array<{ label: string; count: number }> {
  const groups = new Map<string, { label: string; count: number }>()
  for (const item of items) {
    const raw = (item.source ?? '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { label: raw, count: 1 })
      continue
    }
    group.count += 1
    if (!/[A-Z]/.test(group.label) && /[A-Z]/.test(raw)) group.label = raw
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Two source labels that name the same source, ignoring case and padding. */
export function sameSource(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
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
