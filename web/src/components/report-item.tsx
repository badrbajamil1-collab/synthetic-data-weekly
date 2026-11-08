import type { ReactNode } from 'react'
import { ArrowUpRight, CalendarDays } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { formatDate, sourceLabel, type ReportItem as ReportItemData } from '@/lib/report'
import { cn } from '@/lib/utils'

interface ReportItemProps {
  item: ReportItemData
  rank: number
  tags?: ReactNode
  actions?: ReactNode
  /** Optional follow star beside the source badge (Feed page). */
  followControl?: ReactNode
}

const SECTION_BADGES: Record<string, { label: string; className: string }> = {
  top: { label: 'Top Pick', className: 'border-primary/25 bg-primary/10 text-primary' },
  tool: { label: 'Tool / Code', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700' },
  worth: { label: 'Worth a Look', className: 'border-amber-500/25 bg-amber-500/10 text-amber-700' },
}

export function ReportItemRow({ item, rank, tags, actions, followControl }: ReportItemProps) {
  const sectionMeta = SECTION_BADGES[item.section] ?? SECTION_BADGES.top
  const fitScore = item.well7_fit ?? item.score

  return (
    <article className="group grid gap-5 rounded-2xl border border-border/80 bg-white p-5 shadow-2xs transition-all hover:border-primary/30 hover:shadow-sm sm:grid-cols-[42px_minmax(0,1fr)_104px] sm:gap-6 sm:p-6">
      <div className="hidden sm:flex sm:flex-col sm:items-center sm:pt-0.5">
        <span className="grid size-8 place-items-center rounded-lg border border-border bg-background font-mono text-xs font-semibold text-muted-foreground group-hover:border-primary/30 group-hover:text-primary">
          {String(rank).padStart(2, '0')}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
          <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold sm:hidden">
            #{String(rank).padStart(2, '0')}
          </span>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide',
              sectionMeta.className,
            )}
          >
            {sectionMeta.label}
          </span>
          <div className="inline-flex items-center gap-1">
            <Badge variant="secondary" className="font-medium">{sourceLabel(item.source)}</Badge>
            {followControl}
          </div>
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
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
            <ArrowUpRight className="mb-1 ml-1.5 inline size-4 text-primary/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </h3>

        <p className="mt-3 max-w-3xl break-words text-[15px] leading-7 text-ink/80">
          {item.summary || 'The source summary is not available in this archive entry.'}
        </p>

        {item.reason && (
          <div className="mt-4 max-w-3xl rounded-xl border border-primary/15 bg-primary/[0.04] px-3.5 py-2.5 text-sm leading-6 text-ink/85">
            <span className="font-semibold text-primary">Well7 Signal: </span>
            {item.reason}
          </div>
        )}

        {tags && <div className="mt-4 flex flex-wrap gap-2">{tags}</div>}
        {actions && <div className="mt-5 border-t border-border/60 pt-4">{actions}</div>}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-4 sm:flex-col sm:justify-start sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 sm:text-center">
        <div className="rounded-xl border border-border/80 bg-background/70 px-3 py-2.5 sm:w-full">
          <span className="block font-mono text-2xl font-bold leading-none tabular-nums text-primary">
            {fitScore}
            <span className="text-xs font-normal text-muted-foreground">/10</span>
          </span>
          <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Well7 Fit
          </span>
        </div>
        <div className="text-right sm:mt-1 sm:w-full sm:text-center">
          <span className="font-mono text-xs font-semibold tabular-nums text-ink/80">
            Score {item.score}/10
          </span>
          <span className="block text-[11px] text-muted-foreground">Relevance</span>
        </div>
      </div>
    </article>
  )
}
