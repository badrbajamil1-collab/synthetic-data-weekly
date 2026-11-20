import { useId, useState } from 'react'
import { Plus, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { TOPICS } from '@/lib/feed'
import { cn } from '@/lib/utils'
import { sameFollow, sameTopic, type TopicFollow, type TopicKind } from '@/lib/topics'

export interface TopicCount {
  kind: TopicKind
  label: string
  count: number
}

interface TopicPanelProps {
  id?: string
  follows: TopicFollow[]
  counts: TopicCount[]
  onToggle: (kind: TopicKind, value: string, next: boolean) => void | Promise<void>
}

const DEFAULT_SOURCES = ['arXiv', 'GitHub', 'Hacker News', 'Google News', 'Reddit', 'Research Blogs']

/**
 * The Feed page's My topics & sources manager: displays all 20 synthetic-data topics,
 * any custom topics the user has added, and all sources, plus an input to follow
 * any custom keyword.
 */
export function TopicPanel({ id, follows, counts, onToggle }: TopicPanelProps) {
  const [customTopic, setCustomTopic] = useState('')
  const inputId = useId()

  // Merge the 20 standard TOPICS + any archive counts + any custom followed topics (case-insensitively)
  const topicMap = new Map<string, { label: string; count: number }>()
  for (const t of TOPICS) {
    topicMap.set(t.label.toLowerCase(), { label: t.label, count: 0 })
  }
  for (const row of counts) {
    if (row.kind === 'topic') {
      const key = row.label.toLowerCase()
      const existing = topicMap.get(key)
      topicMap.set(key, { label: existing?.label ?? row.label, count: row.count })
    }
  }
  for (const follow of follows) {
    if (follow.kind === 'topic') {
      const key = follow.value.trim().toLowerCase()
      if (key && !topicMap.has(key)) {
        topicMap.set(key, { label: follow.value, count: 0 })
      }
    }
  }

  const allTopics: TopicCount[] = [...topicMap.values()]
    .map((entry) => ({ kind: 'topic' as TopicKind, label: entry.label, count: entry.count }))
    .sort((a, b) => {
      const aFollowed = follows.some((f) => f.kind === 'topic' && sameTopic(f.value, a.label)) ? 1 : 0
      const bFollowed = follows.some((f) => f.kind === 'topic' && sameTopic(f.value, b.label)) ? 1 : 0
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
    const existing = topicMap.get(trimmed.toLowerCase())
    void onToggle('topic', existing?.label ?? trimmed, true)
    setCustomTopic('')
  }

  return (
    <section id={id} aria-labelledby="topic-panel-heading" className="rounded-2xl border border-border bg-white p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h2 id="topic-panel-heading" className="font-display text-xl font-medium tracking-[-0.02em] text-ink">
            Topics &amp; sources
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Star any topic or source to personalize your feed, or add your own custom keyword.
          </p>
        </div>

        <form onSubmit={handleAddCustom} className="flex w-full items-center gap-2 sm:w-auto">
          <label htmlFor={inputId} className="sr-only">
            Add custom topic keyword
          </label>
          <input
            id={inputId}
            name="custom-topic"
            type="text"
            value={customTopic}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(event) => setCustomTopic(event.target.value)}
            placeholder="Add custom topic (e.g. EHR, SQL)…"
            maxLength={80}
            className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background/60 px-3 text-sm text-ink placeholder:text-muted-foreground focus-visible:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56 sm:flex-none"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!customTopic.trim()} className="h-10 shrink-0 rounded-xl px-3.5">
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
            <h3 className="text-xs font-semibold text-muted-foreground">
              {title}
            </h3>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {rows.map((row) => {
                const stored = follows.find((follow) => sameFollow(follow, row.kind, row.label))
                const followed = stored !== undefined
                return (
                  <button
                    key={`${row.kind}:${row.label}`}
                    type="button"
                    aria-pressed={followed}
                    aria-label={followed ? `Stop following ${row.label}` : `Follow ${row.label} in your feed`}
                    onClick={() => void onToggle(row.kind, stored?.value ?? row.label, !followed)}
                    className={cn(
                      'touch-target inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      followed
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border bg-white text-ink hover:border-primary/40 hover:text-primary',
                    )}
                  >
                    <span>{row.label}</span>
                    {row.count > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {row.count}
                      </span>
                    )}
                    <Star
                      className={cn(
                        'size-3.5 shrink-0',
                        followed ? 'fill-current text-amber-600' : 'text-slate-600',
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
    </section>
  )
}
