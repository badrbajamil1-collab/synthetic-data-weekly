import type { ReactNode } from 'react'
import { ArrowUpRight, CalendarDays } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatDate, sourceLabel, type ReportItem as ReportItemData } from '@/lib/report'

interface ReportItemProps {
  item: ReportItemData
  rank: number
  tags?: ReactNode
  actions?: ReactNode
  /** Optional follow star beside the source badge (Feed page). */
  followControl?: ReactNode
}

export function ReportItemRow({ item, rank, tags, actions, followControl }: ReportItemProps) {
  return (
    <article className="group grid gap-5 border-t border-border py-7 first:border-t-0 first:pt-1 sm:grid-cols-[36px_minmax(0,1fr)_86px] sm:gap-6">
      <span className="hidden pt-1 font-mono text-sm text-muted-foreground sm:block">
        {String(rank).padStart(2, '0')}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="inline-flex items-center gap-1">
            <Badge variant="secondary">{sourceLabel(item.source)}</Badge>
            {followControl}
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {formatDate(item.published, 'short')}
          </span>
        </div>

        <h3 className="mt-3 max-w-3xl break-words text-balance font-display text-xl font-medium leading-snug tracking-[-0.015em] text-ink sm:text-2xl">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm break-words decoration-primary/40 underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.title}
            <ArrowUpRight className="mb-1 ml-1.5 inline size-4" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </h3>

        <p className="mt-3 max-w-3xl break-words text-[15px] leading-7 text-muted-foreground">
          {item.summary || 'The source summary is not available in this archive entry.'}
        </p>

        {item.reason && (
          <p className="mt-4 max-w-3xl break-words border-l-2 border-primary/30 pl-3 text-sm leading-6 text-ink/75">
            <span className="font-semibold text-ink">Why it matters: </span>
            {item.reason}
          </p>
        )}

        {tags && <div className="mt-4 flex flex-wrap gap-2">{tags}</div>}
        {actions && <div className="mt-5">{actions}</div>}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4 sm:block sm:border-l sm:border-t-0 sm:pl-5 sm:pt-1 sm:text-center">
        <div>
          <span className="block font-display text-3xl font-medium leading-none tabular-nums text-ink">{item.score}</span>
          <span className="mt-1 block text-xs text-muted-foreground">relevance / 10</span>
        </div>
        {item.well7_fit !== null && (
          <div className="sm:mt-4">
            <span className="block text-sm font-semibold tabular-nums text-mint">{item.well7_fit} / 10</span>
            <span className="mt-1 block text-xs text-muted-foreground">Well7 fit</span>
          </div>
        )}
      </div>
    </article>
  )
}
