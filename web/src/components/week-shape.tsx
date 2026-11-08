import { FileText } from 'lucide-react'

import { sourceLabel, type ReportItem } from '@/lib/report'
import { scoreBands, sourceCounts } from '@/lib/topics'

/**
 * Quiet, single-tier summary of the week's signal distribution and sources.
 * Avoids repeating topic counts (which live interactively in KeywordStrip right
 * below) and uses crisp HTML/SVG geometry instead of stretched viewBox text.
 */
export function WeekShape({ items }: { items: ReportItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-8 text-center">
        <FileText className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">Nothing published this week yet.</p>
      </div>
    )
  }

  const bands = scoreBands(items.map((item) => item.well7_fit ?? item.score))
  const total = bands.reduce((sum, band) => sum + band.count, 0)
  const sources = sourceCounts(items).map((row) => ({
    label: sourceLabel(row.label),
    count: row.count,
  }))
  const maxSource = sources.reduce((best, row) => Math.max(best, row.count), 1)

  const bandColors: Record<string, string> = {
    '8–10': 'bg-primary',
    '5–7': 'bg-primary/45',
    '1–4': 'bg-muted-foreground/30',
  }

  const bandLabels: Record<string, string> = {
    '8–10': 'High fit (8–10)',
    '5–7': 'Moderate (5–7)',
    '1–4': 'Exploratory (1–4)',
  }

  return (
    <div
      className="grid gap-8 rounded-2xl border border-border/75 bg-white p-6 sm:p-7 md:grid-cols-2 md:gap-12"
      role="region"
      aria-label="Weekly signal summary"
    >
      {/* Left: Signal Distribution */}
      <figure className="flex flex-col justify-between">
        <div className="flex items-baseline justify-between gap-4">
          <figcaption className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Well7 signal distribution
          </figcaption>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {total} {total === 1 ? 'finding' : 'findings'}
          </span>
        </div>

        {/* Proportional segmented bar */}
        <div
          className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-secondary p-0.5 gap-0.5"
          role="img"
          aria-label={`Well7 fit bands: ${bands.map((b) => `${b.label}: ${b.count}`).join(', ')}`}
        >
          {bands
            .filter((b) => b.count > 0)
            .map((band) => (
              <div
                key={band.label}
                style={{ width: `${(band.count / Math.max(total, 1)) * 100}%` }}
                className={`h-full first:rounded-l-full last:rounded-r-full ${bandColors[band.label] ?? 'bg-primary'}`}
              />
            ))}
        </div>

        <ul className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          {bands.map((band) => (
            <li key={band.label} className="flex items-center gap-2 text-muted-foreground">
              <span
                className={`size-2 rounded-full ${bandColors[band.label] ?? 'bg-primary'}`}
                aria-hidden="true"
              />
              <span>{bandLabels[band.label] ?? band.label}</span>
              <span className="font-mono font-semibold text-ink tabular-nums">{band.count}</span>
            </li>
          ))}
        </ul>
      </figure>

      {/* Right: Sources */}
      <figure className="border-t border-border/60 pt-6 md:border-l md:border-t-0 md:pl-10 md:pt-0">
        <figcaption className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Sources represented
        </figcaption>
        <ul className="mt-3.5 space-y-2.5">
          {sources.map((row) => {
            const widthPct = Math.max((row.count / maxSource) * 100, 6)
            return (
              <li key={row.label} className="grid grid-cols-[110px_1fr_28px] items-center gap-3 text-xs">
                <span className="truncate font-medium text-ink/85">{row.label}</span>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="text-right font-mono text-muted-foreground tabular-nums">
                  {row.count}
                </span>
              </li>
            )
          })}
        </ul>
      </figure>
    </div>
  )
}
