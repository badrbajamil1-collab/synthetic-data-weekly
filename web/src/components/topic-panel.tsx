import { Star } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { TopicFollow, TopicKind } from '@/lib/topics'

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

/**
 * The Feed page's **My topics** manager (spec): every topic and source seen in
 * the archive, with counts, and a toggle for each.
 *
 * The whole row is the control, not just the 14px star — a star-only hit target
 * reads as "the star does nothing" when the click lands a few pixels off. The
 * row is a single button (no nested buttons) so keyboard and screen-reader
 * users get the same target: aria-pressed states the follow, and the star is
 * decorative.
 */
export function TopicPanel({ follows, counts, onToggle }: TopicPanelProps) {
  return (
    <div className="rounded-[24px] border border-border bg-white/70 p-6">
      <h3 className="font-display text-lg font-semibold tracking-[-0.02em]">My topics</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Star what you want in your feed. Everything is listed below otherwise.
      </p>

      <div className="mt-5 space-y-5">
        {(['topic', 'source'] as TopicKind[]).map((kind) => {
          const rows = counts.filter((row) => row.kind === kind)
          if (rows.length === 0) return null
          return (
            <div key={kind} className="grid gap-2 sm:grid-cols-2">
              <h4 className="col-span-full text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {kind === 'topic' ? 'Topics' : 'Sources'}
              </h4>
              {rows.map((row) => {
                const followed = follows.some((follow) => follow.kind === row.kind && follow.value === row.label)
                return (
                  <button
                    key={`${row.kind}:${row.label}`}
                    type="button"
                    aria-pressed={followed}
                    aria-label={followed ? `Stop following ${row.label}` : `Follow ${row.label} in your feed`}
                    title={followed ? 'Stop following' : 'Follow in your feed'}
                    onClick={() => void onToggle(row.kind, row.label, !followed)}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-full border px-3.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      followed
                        ? 'border-primary/45 bg-primary/10 text-primary'
                        : 'border-border bg-white text-ink hover:border-primary/40 hover:text-primary',
                    )}
                  >
                    <span className="min-w-0 truncate text-sm">
                      {row.label}
                      <span className="ml-2 text-xs tabular-nums text-muted-foreground">{row.count}</span>
                    </span>
                    <Star
                      className={cn('size-3.5 shrink-0', followed ? 'fill-current text-primary' : 'text-muted-foreground/60')}
                      aria-hidden="true"
                    />
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
