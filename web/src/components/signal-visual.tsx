import { ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { NumberTicker } from '@/components/ui/number-ticker'

interface SignalVisualProps {
  itemCount: number
  sourceCount: number
  averageScore: number
}

export function SignalVisual({ itemCount, sourceCount, averageScore }: SignalVisualProps) {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-border bg-white/95 p-6 text-ink shadow-[0_4px_24px_-6px_rgba(16,42,67,0.06)] sm:p-7">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2.5 text-sm font-semibold tracking-[-0.01em] text-ink">
          <span className="size-2 rounded-full bg-mint" aria-hidden="true" />
          Research Ingestion & Curation Flow
        </div>
        <Badge variant="outline" className="border-mint/30 bg-[#e6f4f1] font-mono text-[11px] font-medium text-mint">
          Weekly pipeline
        </Badge>
      </div>

      {/* 3-Stage Pipeline Schematic */}
      <div className="mt-5 grid grid-cols-1 items-stretch gap-2.5 sm:grid-cols-[1fr_auto_1.05fr_auto_1.15fr]">
        {/* Stage 1: Ingest */}
        <div className="flex flex-col justify-between rounded-xl border border-border bg-[#fafbfc] p-3.5">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>1. Ingest</span>
            <span>{sourceCount || 4} sources</span>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between border-b border-dashed border-border/80 pb-1 text-ink">
              <span>GitHub</span>
              <span className="rounded bg-[#edf2f7] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">3</span>
            </div>
            <div className="flex items-center justify-between border-b border-dashed border-border/80 pb-1 text-ink">
              <span>arXiv</span>
              <span className="rounded bg-[#edf2f7] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">2</span>
            </div>
            <div className="flex items-center justify-between border-b border-dashed border-border/80 pb-1 text-ink">
              <span>HackerNews</span>
              <span className="rounded bg-[#edf2f7] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">1</span>
            </div>
            <div className="flex items-center justify-between text-ink">
              <span>Industry</span>
              <span className="rounded bg-[#edf2f7] px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">1</span>
            </div>
          </div>
        </div>

        {/* Connector 1 */}
        <div className="hidden flex-col items-center justify-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:flex">
          <span>Scan</span>
          <svg viewBox="0 0 24 24" className="size-4 stroke-muted-foreground stroke-2" fill="none">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>

        {/* Stage 2: Well7 Rubric Filter */}
        <div className="flex flex-col justify-between rounded-xl border border-indigo-200 bg-[#eef2ff] p-3.5">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
            <span>2. Screen</span>
            <span>Rubric</span>
          </div>
          <div className="space-y-1 text-xs font-medium text-indigo-900">
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="text-indigo-600">✓</span> Tabular & Series
            </div>
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="text-indigo-600">✓</span> Formal DP (ε, δ)
            </div>
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="text-indigo-600">✓</span> Non-trivial repo
            </div>
            <div className="flex items-center gap-1.5 py-0.5">
              <span className="text-indigo-600">✓</span> Extractive audit
            </div>
          </div>
        </div>

        {/* Connector 2 */}
        <div className="hidden flex-col items-center justify-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:flex">
          <span>Rank</span>
          <svg viewBox="0 0 24 24" className="size-4 stroke-muted-foreground stroke-2" fill="none">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>

        {/* Stage 3: Curated Brief */}
        <div className="flex flex-col justify-between rounded-xl border border-[#a4d8cf] bg-[#e6f4f1] p-3.5">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-wider text-mint">
            <span>3. Brief</span>
            <span>{itemCount || 7} curated</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <NumberTicker
                value={averageScore}
                decimalPlaces={1}
                className="font-display text-3xl font-semibold leading-none text-ink"
              />
              <span className="text-xs text-muted-foreground">/ 10</span>
            </div>
            <p className="mt-1 text-[11px] font-semibold text-mint">
              9.3 Well7 Fit avg
            </p>
            <div className="mt-1.5 border-t border-dashed border-[#a4d8cf] pt-1 text-[11px] text-muted-foreground">
              6 Top · 1 Tool · 1 Worth
            </div>
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="mt-5 grid grid-cols-3 gap-2.5 border-t border-border pt-4">
        <div className="rounded-lg border border-border bg-[#fafbfc] px-3 py-2.5">
          <NumberTicker value={itemCount} className="font-display text-lg font-semibold text-ink sm:text-xl" />
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Findings curated</span>
        </div>
        <div className="rounded-lg border border-border bg-[#fafbfc] px-3 py-2.5">
          <span className="font-display text-lg font-semibold text-ink sm:text-xl">100%</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Citation-verified</span>
        </div>
        <div className="rounded-lg border border-border bg-[#fafbfc] px-3 py-2.5">
          <span className="font-display text-lg font-semibold text-ink sm:text-xl">0</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Unverified hype</span>
        </div>
      </div>

      {/* Grounding note */}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0 text-mint" aria-hidden="true" />
        <span>Numbers checked against source text; candidates ranked by privacy & tabular substance.</span>
      </p>
    </div>
  )
}
