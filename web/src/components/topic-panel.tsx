import { useState } from 'react'
import { Plus, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TOPICS } from '@/lib/feed'
import { cn } from '@/lib/utils'
import { sameSource, type TopicFollow, type TopicKind } from '@/lib/topics'

export interface TopicCount {
  kind: TopicKind
  label: string
  count: number
}

interface TopicPanelProps {
  follows: TopicFollow[]
  counts: TopicCount[]
  onToggle: (kind: TopicKind, value: string, next: boolean) => void | Promise<void>
}

const DEFAULT_SOURCES = ['arXiv', 'GitHub', 'Hacker News', 'Google News', 'Reddit', 'Research Blogs']

/**
 * The Feed page's **My topics** manager: displays all 20 synthetic-data topics,
 * any custom topics the user has added, and all sources, plus an input to follow
 * any custom keyword.
 */
export function TopicPanel({ follows, counts, onToggle }: TopicPanelProps) {
  const [customTopic, setCustomTopic] = useState('')

  // Merge the 20 standard TOPICS + any archive counts + any custom followed topics
  const topicMap = new Map<string, number>()
  for (const t of TOPICS) {
    topicMap.set(t.label, 0)
  }
  for (const row of counts) {
    if (row.kind === 'topic') {
      topicMap.set(row.label, row.count)
    }
  }
  for (const follow of follows) {
    if (follow.kind === 'topic' && !topicMap.has(follow.value)) {
      topicMap.set(follow.value, 0)
    }
  }

  const allTopics: TopicCount[] = [...topicMap.entries()]
    .map(([label, count]) => ({ kind: 'topic' as TopicKind, label, count }))
    .sort((a, b) => {
      const aFollowed = follows.some((f) => f.kind === 'topic' && f.value === a.label) ? 1 : 0
      const bFollowed = follows.some((f) => f.kind === 'topic' && f.value === b.label) ? 1 : 0
      return bFollowed - aFollowed || b.count - a.count || a.label.localeCompare(b.label)
    })

  // Merge standard sources + archive sources
  const sourceMap = new Map<string, { label: string; count: number }>()
  for (const s of DEFAULT_SOURCES) {
    sourceMap.set(s.toLowerCase(), { label: s, count: 0 })
  }
  for (const row of counts) {
    if (row.kind === 'source') {
      const key = row.label.toLowerCase()
      const existing = sourceMap.get(key)
      sourceMap.set(key, { label: existing?.label ?? row.label, count: row.count })
    }
  }
  const allSources: TopicCount[] = [...sourceMap.values()]
    .map((s) => ({ kind: 'source' as TopicKind, label: s.label, count: s.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  function handleAddCustom(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = customTopic.trim()
    if (!trimmed) return
    void onToggle('topic', trimmed, true)
    setCustomTopic('')
  }

  return (
    <div className="rounded-2xl border border-border/75 bg-white p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h3 className="font-display text-lg font-medium tracking-[-0.02em] text-ink">
            My topics & sources
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Star any topic or source to personalize your feed, or add your own custom keyword.
          </p>
        </div>

        <form onSubmit={handleAddCustom} className="flex items-center gap-2">
          <input
            type="text"
            value={customTopic}
            onChange={(event) => setCustomTopic(event.target.value)}
            placeholder="Add custom topic (e.g. EHR, SQL)…"
            maxLength={80}
            className="h-9 w-56 rounded-xl border border-border/80 bg-background/50 px-3 text-xs text-ink placeholder:text-muted-foreground focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!customTopic.trim()}>
            <Plus className="size-3.5" aria-hidden="true" />
            Follow
          </Button>
        </form>
      </div>

      <div className="mt-6 space-y-6">
        {(
          [
            { kind: 'topic' as TopicKind, title: `Topics (${allTopics.length})`, rows: allTopics },
            { kind: 'source' as TopicKind, title: `Sources (${allSources.length})`, rows: allSources },
          ] as const
        ).map(({ kind, title, rows }) => (
          <div key={kind}>
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </h4>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {rows.map((row) => {
                const stored = follows.find(
                  (follow) =>
                    follow.kind === row.kind &&
                    (row.kind === 'source'
                      ? sameSource(follow.value, row.label)
                      : follow.value.toLowerCase() === row.label.toLowerCase()),
                )
                const followed = stored !== undefined
                return (
                  <button
                    key={`${row.kind}:${row.label}`}
                    type="button"
                    aria-pressed={followed}
                    aria-label={followed ? `Stop following ${row.label}` : `Follow ${row.label} in your feed`}
                    title={followed ? 'Click to unfollow' : 'Click to follow in your feed'}
                    onClick={() => void onToggle(row.kind, stored?.value ?? row.label, !followed)}
                    className={cn(
                      'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      followed
                        ? 'border-primary/45 bg-primary/10 text-primary'
                        : 'border-border/75 bg-white text-ink/80 hover:border-primary/35 hover:text-primary',
                    )}
                  >
                    <span>{row.label}</span>
                    {row.count > 0 && (
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {row.count}
                      </span>
                    )}
                    <Star
                      className={cn(
                        'size-3 shrink-0',
                        followed ? 'fill-current text-amber-500' : 'text-muted-foreground/50',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
