import { Check, Loader2 } from 'lucide-react'

import type { CleanStatsInfo, SourceStatInfo } from '@/lib/api'
import { cn } from '@/lib/utils'

export type StepperNodeId = 'collect' | 'clean' | 'rank' | 'fetch' | 'summarise' | 'publish'

export interface PipelineStepperProps {
  status: 'idle' | 'running' | 'succeeded' | 'failed'
  activeNode: StepperNodeId | null
  completedNodes: StepperNodeId[]
  sourceStats?: SourceStatInfo[]
  cleanStats?: CleanStatsInfo
  scoredCount?: number
  fetchedCount?: number
  sectionCount?: number
  reportId?: string | null
}

const NODE_STEPS: Array<{
  id: StepperNodeId
  label: string
}> = [
  { id: 'collect', label: 'Collect' },
  { id: 'clean', label: 'Clean' },
  { id: 'rank', label: 'Rank' },
  { id: 'fetch', label: 'Fetch' },
  { id: 'summarise', label: 'Summarise' },
  { id: 'publish', label: 'Save' },
]

/**
 * Quiet, single-row progress rail for the 6-stage live search pipeline.
 */
export function PipelineStepper({
  status,
  activeNode,
  completedNodes,
  sourceStats = [],
  cleanStats,
  scoredCount = 0,
  fetchedCount = 0,
  sectionCount = 0,
  reportId,
}: PipelineStepperProps) {
  function metricFor(id: StepperNodeId): string | null {
    switch (id) {
      case 'collect': {
        if (!sourceStats.length && !cleanStats) return null
        const total = cleanStats?.raw ?? sourceStats.reduce((sum, s) => sum + s.count, 0)
        return `${total} found`
      }
      case 'clean':
        if (!cleanStats) return null
        return `${cleanStats.fresh} unique`
      case 'rank':
        return scoredCount > 0 ? `${scoredCount} ranked` : null
      case 'fetch':
        return fetchedCount > 0 ? `${fetchedCount} read` : null
      case 'summarise':
        return sectionCount > 0 ? `${sectionCount} summaries` : null
      case 'publish':
        if (reportId) return reportId
        return completedNodes.includes('publish') ? 'Saved' : null
    }
  }

  const activeLabel = NODE_STEPS.find((step) => step.id === activeNode)?.label
  const liveStatusText =
    status === 'running'
      ? activeLabel
        ? `Search in progress: ${activeLabel}.`
        : 'Search in progress.'
      : status === 'succeeded'
        ? 'Search completed.'
        : status === 'failed'
          ? 'Search failed.'
          : ''

  return (
    <div className="rounded-2xl border border-border bg-[#fffdf9] px-5 py-4 shadow-[0_6px_18px_rgba(14,62,64,0.05)] sm:px-6">
      <p className="sr-only" role="status" aria-live="polite">
        {liveStatusText}
      </p>

      <ol className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {NODE_STEPS.map((step, index) => {
          const done = completedNodes.includes(step.id)
          const active = status === 'running' && activeNode === step.id && !done
          const metric = metricFor(step.id)

          return (
            <li
              key={step.id}
              aria-current={active ? 'step' : undefined}
              className="flex flex-col items-start gap-1 border-b border-border/70 pb-2 sm:border-b-0 sm:pb-0 lg:border-r lg:border-border/70 lg:pr-3 lg:last:border-r-0 lg:last:pr-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold transition-colors',
                    done && 'bg-[#0e6245] text-white',
                    active && 'bg-[#b46319] text-[#fffdf9]',
                    !done && !active && 'border border-input bg-secondary text-muted-foreground',
                  )}
                >
                  {done ? (
                    <>
                      <Check className="size-3" aria-hidden="true" />
                      <span className="sr-only">Completed</span>
                    </>
                  ) : active ? (
                    <>
                      <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
                      <span className="sr-only">Running</span>
                    </>
                  ) : (
                    <span aria-hidden="true">{index + 1}</span>
                  )}
                </span>
                <span
                  className={cn(
                    'truncate text-xs',
                    done || active ? 'font-bold text-ink' : 'font-semibold text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </div>

              {metric && (
                <span className="pl-7 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {metric}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {sourceStats.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-3 font-mono text-xs text-muted-foreground">
          <span className="font-sans text-xs font-bold text-muted-foreground">Sources</span>
          {sourceStats.map((source) => (
            <span
              key={source.name}
              className={cn(
                'tabular-nums',
                source.error ? 'text-[#b46319]' : source.count > 0 ? 'text-ink' : 'text-muted-foreground',
              )}
            >
              {source.name}{' '}
              <strong className="font-semibold">{source.count}</strong>
              {source.error && <span className="ml-1 font-sans text-[11px]">(unavailable)</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
