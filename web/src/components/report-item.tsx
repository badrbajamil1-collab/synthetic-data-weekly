import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'

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
  const sectionMeta = SECTION_LABELS[item.section] ?? SECTION_LABELS.top
  const fitScore = item.well7_fit ?? item.score

  return (
    <article className="group rounded-2xl border border-border/75 bg-white p-5 transition-colors hover:border-border sm:p-6">
      {/* Quiet single-line metadata header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
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

        {fitScore > 0 && (
          <div className="flex items-center gap-3 font-mono text-xs tabular-nums">
            <span className="text-muted-foreground">
              Fit <strong className="font-semibold text-ink">{fitScore}</strong>/10
            </span>
            {item.well7_fit !== null && item.score !== item.well7_fit && (
              <span className="text-muted-foreground/75">
                Rel {item.score}/10
              </span>
            )}
          </div>
        )}
      </div>

      {/* Title */}
      <h3 className="mt-2.5 max-w-[68ch] break-words text-balance font-display text-xl font-medium leading-snug tracking-[-0.015em] text-ink sm:text-2xl">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm break-words decoration-primary/40 underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.title}
          <ArrowUpRight
            className="mb-1 ml-1 inline size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
            aria-hidden="true"
          />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </h3>

      {/* Summary */}
      <p className="mt-2.5 max-w-[70ch] break-words text-[15px] leading-7 text-ink/80">
        {item.summary || 'The source summary is not available in this archive entry.'}
      </p>

      {/* Quiet 1px hairline Well7 note — no nested box */}
      {item.reason && (
        <p className="mt-3.5 max-w-[68ch] border-l border-border pl-3.5 text-sm leading-6 text-muted-foreground">
          <span className="font-medium text-ink/85">Well7 rationale: </span>
          {item.reason}
        </p>
      )}

      {/* Footer row: topic pills & actions */}
      {(tags || actions) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-1">
          {tags ? <div className="flex flex-wrap gap-1.5">{tags}</div> : <div />}
          {actions ? <div>{actions}</div> : null}
        </div>
      )}
    </article>
  )
}
