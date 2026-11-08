import { NumberTicker } from '@/components/ui/number-ticker'

interface SignalVisualProps {
  itemCount: number
  sourceCount: number
  averageScore: number
}

/**
 * Quiet editorial schematic of the LangGraph.js research pipeline.
 * Uses flat hairline geometry and generous whitespace — zero nested cards.
 */
export function SignalVisual({ itemCount, sourceCount, averageScore }: SignalVisualProps) {
  const stages = [
    {
      step: '01',
      title: 'Multi-source collection',
      detail: 'arXiv · GitHub · Hacker News · Google News · Reddit · Lab RSS',
      meta: `${sourceCount || 6} active sources`,
      accent: false,
    },
    {
      step: '02',
      title: 'Well7 rubric & deduplication',
      detail: 'Tabular & time-series fidelity, formal DP (ε, δ), non-trivial repositories',
      meta: 'LangGraph.js StateGraph',
      accent: false,
    },
    {
      step: '03',
      title: 'Citation-guarded synthesis',
      detail: 'Full-text extraction with numeric claim verification against source abstracts',
      meta: `${itemCount || 7} curated findings`,
      accent: true,
    },
  ]

  return (
    <div className="rounded-2xl border border-border/80 bg-white p-6 sm:p-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-border/70 pb-4">
        <span className="font-mono text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Pipeline architecture
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          collect → clean → rank → fetch → summarise
        </span>
      </div>

      {/* Hairline schematic flow — no nested boxes */}
      <ol className="relative mt-6 space-y-6 before:absolute before:bottom-3 before:left-[11px] before:top-3 before:w-px before:bg-border">
        {stages.map((stage) => (
          <li key={stage.step} className="relative flex items-start justify-between gap-4 pl-8">
            <span
              className={`absolute left-0 top-1 grid size-6 place-items-center rounded-full border text-[11px] font-mono ${
                stage.accent
                  ? 'border-primary bg-primary text-white font-semibold'
                  : 'border-border bg-white text-muted-foreground'
              }`}
              aria-hidden="true"
            >
              {stage.step}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-sm text-ink">{stage.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{stage.detail}</p>
            </div>
            <span
              className={`shrink-0 font-mono text-xs tabular-nums ${
                stage.accent ? 'font-semibold text-primary' : 'text-muted-foreground'
              }`}
            >
              {stage.meta}
            </span>
          </li>
        ))}
      </ol>

      {/* Single quiet footer metric line */}
      <div className="mt-7 flex flex-wrap items-baseline justify-between gap-4 border-t border-border/70 pt-5">
        <div>
          <span className="text-xs text-muted-foreground">Current brief signal quality</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every number in the brief is checked against the source text before publication.
          </p>
        </div>
        <div className="flex items-baseline gap-1.5">
          <NumberTicker
            value={averageScore}
            decimalPlaces={1}
            className="font-display text-2xl font-medium tracking-[-0.02em] text-ink tabular-nums"
          />
          <span className="font-mono text-xs text-muted-foreground">/ 10 avg fit</span>
        </div>
      </div>
    </div>
  )
}
