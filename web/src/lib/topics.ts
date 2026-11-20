import { topicsFor, type Taggable } from './feed.ts'

export type TopicKind = 'topic' | 'source'

export interface TopicFollow {
  kind: TopicKind
  value: string
}

export type { Taggable }

export interface ChipStateSummary {
  filterAriaPressed: boolean
  followAriaPressed: boolean
  tone: 'idle' | 'active' | 'followed' | 'both'
}

export function describeChipState(input: { active: boolean; followed?: boolean }): ChipStateSummary {
  const followed = Boolean(input.followed)
  const tone: ChipStateSummary['tone'] =
    input.active && followed
      ? 'both'
      : input.active
        ? 'active'
        : followed
          ? 'followed'
          : 'idle'
  return {
    filterAriaPressed: input.active,
    followAriaPressed: followed,
    tone,
  }
}

/** kind first, then value — the same order the D1 endpoint answers in. */
export function sortFollows(follows: TopicFollow[]): TopicFollow[] {
  return [...follows].sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
}

/** Case-insensitive, whitespace-trimmed comparison for topic labels/custom terms. */
export function sameTopic(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** True when a follow entry represents the same kind + value (case-insensitive). */
export function sameFollow(a: TopicFollow, kind: TopicKind, value: string): boolean {
  return a.kind === kind && (kind === 'source' ? sameSource(a.value, value) : sameTopic(a.value, value))
}

/**
 * An item is in my feed iff any of its topic labels is followed as a topic,
 * or a custom topic keyword appears in its text, or its source is followed.
 */
export function matchesFollows(item: Pick<ReportLike, 'source'> & Taggable, follows: TopicFollow[]): boolean {
  const itemTopics = topicsFor(item)
  const fullText = `${item.title} ${item.summary ?? ''} ${item.reason ?? ''}`.toLowerCase()
  return follows.some((follow) => {
    if (follow.kind === 'source') {
      return sameSource(item.source, follow.value)
    }
    if (itemTopics.some((topic) => sameTopic(topic, follow.value))) return true
    const needle = follow.value.trim().toLowerCase()
    return needle.length >= 2 && fullText.includes(needle)
  })
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
