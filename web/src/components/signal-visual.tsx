import { ArrowRight, ArrowUpRight } from 'lucide-react'

import { formatDate, sourceLabel, type ReportItem } from '@/lib/report'
import { Link } from '@/lib/router'

interface SignalVisualProps {
  items: ReportItem[]
  reportId?: string | null
  weekEnd?: string | null
}

/**
 * Customer-facing hero preview showing the top 3 findings from the latest
 * weekly brief — real research content instead of internal pipeline diagrams.
 */
export function SignalVisual({ items, reportId, weekEnd }: SignalVisualProps) {
  const featured = items.slice(0, 3)

  return (
    <div className="rounded-2xl border border-border/80 bg-white p-6 sm:p-7">
      <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-3.5">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Featured this week
        </span>
        {weekEnd && (
          <span className="font-mono text-xs text-muted-foreground">
            Week ending {formatDate(weekEnd, 'short')}
          </span>
        )}
      </div>

      {featured.length > 0 ? (
        <ol className="divide-y divide-border/60">
          {featured.map((item, idx) => {
            const fit = item.well7_fit ?? item.score
            return (
              <li key={item.id} className="py-4 first:pt-4 last:pb-2">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground/70 tabular-nums">
                      0{idx + 1}
                    </span>
                    <span aria-hidden="true" className="text-border">·</span>
                    <span className="font-medium text-ink/80">{sourceLabel(item.source)}</span>
                  </div>
                  {fit > 0 && (
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      Fit <strong className="font-semibold text-ink">{fit}</strong>/10
                    </span>
                  )}
                </div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-display text-base font-medium leading-snug text-ink decoration-primary/40 underline-offset-4 transition-colors hover:text-primary hover:underline"
                >
                  {item.title}
                  <ArrowUpRight className="mb-0.5 ml-1 inline size-3.5 text-muted-foreground" aria-hidden="true" />
                </a>
                {item.reason && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {item.reason}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading this week's curated findings…
        </p>
      )}

      {reportId && (
        <div className="mt-3 border-t border-border/70 pt-3.5">
          <Link
            to={`/brief/${reportId}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            Read all {items.length} findings in this week's brief
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  )
}
