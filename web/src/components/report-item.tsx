import { useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react'

import { formatDate, sourceLabel, type ReportItem as ReportItemData } from '@/lib/report'
import { cn } from '@/lib/utils'

interface ReportItemProps {
  item: ReportItemData
  rank: number
  tags?: ReactNode
  actions?: ReactNode
  /** Optional follow star beside the source label (Feed/Brief/Studio). */
  followControl?: ReactNode
}

const SECTION_LABELS: Record<string, { label: string; className: string }> = {
  top: { label: 'Top Pick', className: 'text-primary' },
  tool: { label: 'Tool & Code', className: 'text-emerald-700' },
  worth: { label: 'Worth a Look', className: 'text-amber-700' },
}

export function ReportItemRow({ item, rank, tags, actions, followControl }: ReportItemProps) {
  const [expanded, setExpanded] = useState(false)
  const sectionMeta = SECTION_LABELS[item.section] ?? SECTION_LABELS.top
  const summaryText = item.summary || 'The source summary is not available in this archive entry.'
  const hasMoreContent = summaryText.length > 160 || Boolean(item.reason)

  return (
    <article className="group rounded-2xl border border-border/75 bg-white px-5 py-4 transition-colors hover:border-border sm:px-6 sm:py-5">
      {/* Compact single-line metadata header */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono text-muted-foreground/70 tabular-nums">
          {String(rank).padStart(2, '0')}
        </span>
        <span aria-hidden="true" className="text-border">·</span>
        <span className={cn('font-medium', sectionMeta.className)}>
          {sectionMeta.label}
        </span>
        <span aria-hidden="true" className="text-border">·</span>
        <span className="inline-flex items-center gap-1 font-medium text-ink/80">
          {sourceLabel(item.source)}
          {followControl}
        </span>
        <span aria-hidden="true" className="text-border">·</span>
        <span className="font-mono tabular-nums">
          {formatDate(item.published, 'short')}
        </span>
      </div>

      {/* Title */}
      <h3 className="mt-1.5 max-w-[68ch] break-words text-balance font-display text-lg font-medium leading-snug tracking-[-0.015em] text-ink sm:text-xl">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm break-words decoration-primary/40 underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.title}
          <ArrowUpRight
            className="mb-0.5 ml-1 inline size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
            aria-hidden="true"
          />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </h3>

      {/* Compact 2-line preview by default; full text on click */}
      <p
        className={cn(
          'mt-2 max-w-[72ch] break-words text-sm leading-6 text-ink/80',
          !expanded && 'line-clamp-2',
        )}
      >
        {summaryText}
      </p>

      {expanded && item.reason && (
        <p className="mt-3 max-w-[68ch] border-l border-border pl-3.5 text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-ink/85">Why it matters: </span>
          {item.reason}
        </p>
      )}

      {hasMoreContent && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 border-t border-border/50 pt-3">
          {tags ? <div className="flex flex-wrap gap-1.5">{tags}</div> : <div />}
          {actions ? <div>{actions}</div> : null}
        </div>
      )}
    </article>
  )
}
