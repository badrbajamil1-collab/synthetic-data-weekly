import { FollowToggle } from '@/components/follow-toggle'
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
                  <div
                    key={`${row.kind}:${row.label}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3.5 py-2"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">
                      {row.label}
                      <span className="ml-2 text-xs tabular-nums text-muted-foreground">{row.count}</span>
                    </span>
                    <FollowToggle kind={row.kind} value={row.label} followed={followed} onToggle={onToggle} />
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
