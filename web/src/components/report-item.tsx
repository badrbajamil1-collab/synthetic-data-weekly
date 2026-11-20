import { useId, useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react'

import { formatDate, sourceLabel, type ReportItem as ReportItemData } from '@/lib/report'
import { cn } from '@/lib/utils'

interface ReportItemProps {
  item: ReportItemData
  rank: number
  headingLevel?: 'h2' | 'h3'
  tags?: ReactNode
  actions?: ReactNode
  /** Optional follow star beside the source label (Feed/Brief/Studio). */
  followControl?: ReactNode
}

const SECTION_LABELS: Record<string, { label: string; className: string }> = {
  top: { label: 'Top pick', className: 'text-primary' },
  tool: { label: 'Tool & code', className: 'text-emerald-800' },
  worth: { label: 'Worth a look', className: 'text-amber-800' },
}

export function ReportItemRow({
  item,
  rank,
  headingLevel = 'h3',
  tags,
  actions,
  followControl,
}: ReportItemProps) {
  const [expanded, setExpanded] = useState(false)
  const summaryId = useId()
  const sectionMeta = SECTION_LABELS[item.section] ?? SECTION_LABELS.top
  const summaryText = item.summary || 'The source summary is not available in this archive entry.'
  const hasMoreContent = summaryText.length > 105 || Boolean(item.reason)
  const Heading = headingLevel

  return (
    <article className="rounded-2xl border border-border bg-white px-5 py-4 transition-colors hover:border-slate-300 sm:px-6 sm:py-5">
      {/* Structured metadata row without decorative middle dots */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono font-medium text-muted-foreground tabular-nums">
          {String(rank).padStart(2, '0')}
        </span>
        <span className={cn('font-semibold', sectionMeta.className)}>
          {sectionMeta.label}
        </span>
        <span className="inline-flex items-center gap-1 font-medium text-ink">
          {sourceLabel(item.source)}
          {followControl}
        </span>
        <time dateTime={item.published} className="font-mono text-muted-foreground tabular-nums">
          {formatDate(item.published, 'short')}
        </time>
      </div>

      {/* Title: hover affordance scoped strictly to the link itself */}
      <Heading className="mt-2 max-w-[68ch] break-words text-balance font-display text-lg font-medium leading-snug tracking-[-0.015em] text-ink sm:text-xl">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="group/title rounded-sm break-words decoration-primary/50 underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.title}
          <ArrowUpRight
            className="mb-0.5 ml-1 inline size-4 text-muted-foreground transition-transform group-hover/title:text-primary motion-safe:group-hover/title:translate-x-0.5 motion-safe:group-hover/title:-translate-y-0.5"
            aria-hidden="true"
          />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Heading>

      {/* Compact 2-line preview by default; full text on click */}
      <div id={summaryId}>
        <p
          className={cn(
            'mt-2 max-w-[72ch] break-words text-sm leading-6 text-ink/85',
            !expanded && 'line-clamp-2',
          )}
        >
          {summaryText}
        </p>

        {expanded && item.reason && (
          <p className="mt-3 max-w-[68ch] border-l border-border pl-3.5 text-xs leading-5 text-muted-foreground">
            <span className="font-semibold text-ink">Why it matters: </span>
            {item.reason}
          </p>
        )}
      </div>

      {hasMoreContent && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={summaryId}
          onClick={() => setExpanded((prev) => !prev)}
          className="touch-target mt-2 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1 -ml-1 py-1 text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <>
              Show less
              <ChevronUp className="size-3.5" aria-hidden="true" />
            </>
          ) : (
            <>
              Read more
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </>
          )}
        </button>
      )}

      {/* Footer row: topic pills & actions */}
      {(tags || actions) && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5 border-t border-border/70 pt-3">
          {tags ? <div className="flex flex-wrap gap-1.5">{tags}</div> : <div />}
          {actions ? <div>{actions}</div> : null}
        </div>
      )}
    </article>
  )
}
