import { FileText } from 'lucide-react'

import { sourceLabel, type ReportItem } from '@/lib/report'
import { scoreBands, sourceCounts, topicCounts } from '@/lib/topics'

/**
 * The brief page's three static week-shape diagrams (spec `2026-11-06`, "Brief
 * page diagrams"): an importance donut by score band, source bars and topic
 * bars — all computed from the week's items. Pure inline SVG: no chart
 * library, no tooltips, no animation.
 */

const DONUT_STROKE: Record<string, string> = {
  '8–10': 'stroke-primary',
  '5–7': 'stroke-primary/55',
  '1–4': 'stroke-muted-foreground/40',
}

function ImportanceDonut({ items }: { items: ReportItem[] }) {
  const bands = scoreBands(items.map((item) => item.well7_fit ?? item.score))
  const total = bands.reduce((sum, band) => sum + band.count, 0)
  const radius = 40
  const circumference = 2 * Math.PI * radius

  // Prefix-summed band starts in COUNTS, converted to circumference FRACTIONS
  // for the dash offset — an offset in path-length units must be a fraction of
  // the ring, not the count itself.
  const segments = bands.map((band, index) => ({
    band,
    fraction: total > 0 ? band.count / total : 0,
    startCount: bands.slice(0, index).reduce((sum, earlier) => sum + earlier.count, 0),
  }))

  return (
    <figure>
      <figcaption className="text-sm font-semibold text-muted-foreground">
        Well7 fit
        <span className="block font-normal">Importance bands; relevance where a paper is unrated.</span>
      </figcaption>
      <div className="mt-3 flex items-center gap-5">
        <svg viewBox="0 0 120 120" className="size-28 shrink-0" role="img" aria-label={`Importance donut: ${bands.map((band) => `${band.label} ${band.count}`).join(', ')}`}>
          <circle cx="60" cy="60" r={radius} fill="none" strokeWidth="16" className="stroke-border/60" />
          {total > 0 && segments.filter((segment) => segment.band.count > 0).map(({ band, fraction, startCount }) => (
            <circle
              key={band.label}
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              strokeWidth="16"
              strokeLinecap="butt"
              className={DONUT_STROKE[band.label]}
              strokeDasharray={`${Math.max(fraction * circumference - 2, 0)} ${circumference}`}
              strokeDashoffset={-((startCount / total) * circumference)}
              transform="rotate(-90 60 60)"
            />
          ))}
          <text x="60" y="65" textAnchor="middle" className="fill-ink font-display text-2xl">{total}</text>
        </svg>
        <ul className="space-y-2 text-sm">
          {bands.map((band) => (
            <li key={band.label} className="flex items-center gap-2 text-muted-foreground">
              <span className={`size-2.5 rounded-full ${band.label === '8–10' ? 'bg-primary' : band.label === '5–7' ? 'bg-primary/55' : 'bg-muted-foreground/40'}`} aria-hidden="true" />
              <span className="font-medium text-ink tabular-nums">{band.count}</span>
              <span className="tabular-nums">{band.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}

function CountBars({ rows, caption }: { rows: Array<{ label: string; count: number }>; caption: string }) {
  const max = rows.reduce((best, row) => Math.max(best, row.count), 0)
  const rowHeight = 24
  return (
    <figure>
      <figcaption className="text-sm font-semibold text-muted-foreground">{caption}</figcaption>
      <svg
        viewBox={`0 0 220 ${rows.length * rowHeight}`}
        className="mt-3 w-full"
        style={{ height: rows.length * rowHeight + 4 }}
        role="img"
        aria-label={`${caption}: ${rows.map((row) => `${row.label} ${row.count}`).join(', ')}`}
      >
        {rows.map((row, index) => {
          const barWidth = max > 0 ? (row.count / max) * 108 : 0
          const y = index * rowHeight
          return (
            <g key={row.label} transform={`translate(0 ${y})`}>
              <rect x="0" y="5" width={Math.max(barWidth, 4)} height="14" rx="7" className="fill-primary/75" />
              <text x={Math.max(barWidth, 4) + 8} y="16" fontSize="11" className="fill-ink/80 tabular-nums">{row.count}</text>
              <text x="122" y="15" fontSize="11" className="fill-muted-foreground">{row.label}</text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

export function WeekShape({ items }: { items: ReportItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-8 text-center">
        <FileText className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-2 text-sm text-muted-foreground">Nothing published this week yet.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-8 rounded-[24px] border border-border bg-white/70 p-6 sm:p-8 lg:grid-cols-3 lg:gap-10">
      <ImportanceDonut items={items} />
      <CountBars rows={sourceCounts(items).map((row) => ({ ...row, label: sourceLabel(row.label) }))} caption="Sources" />
      <CountBars rows={topicCounts(items)} caption="Topics" />
    </div>
  )
}
