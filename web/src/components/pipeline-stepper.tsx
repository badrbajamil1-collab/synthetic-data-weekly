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
  { id: 'publish', label: 'Checkpoint' },
]

/**
 * Quiet, single-row progress rail for the 6-node LangGraph.js pipeline.
 * Avoids nested cards and decorative icon boxes.
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
        return `${total} raw`
      }
      case 'clean':
        if (!cleanStats) return null
        return `${cleanStats.fresh} fresh`
      case 'rank':
        return scoredCount > 0 ? `${scoredCount} scored` : null
      case 'fetch':
        return fetchedCount > 0 ? `${fetchedCount} texts` : null
      case 'summarise':
        return sectionCount > 0 ? `${sectionCount} guarded` : null
      case 'publish':
        if (reportId) return reportId
        return completedNodes.includes('publish') ? 'D1 saved' : null
    }
  }

  return (
    <div className="rounded-2xl border border-border/75 bg-white px-5 py-4 sm:px-6">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {NODE_STEPS.map((step, index) => {
          const done = completedNodes.includes(step.id)
          const active = status === 'running' && activeNode === step.id && !done
          const metric = metricFor(step.id)

          return (
            <li
              key={step.id}
              className="flex items-center justify-between gap-2 border-b border-border/50 pb-2 sm:border-b-0 sm:pb-0"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-full font-mono text-[10px] transition-colors',
                    done && 'bg-emerald-600 text-white',
                    active && 'bg-primary text-white',
                    !done && !active && 'border border-border text-muted-foreground',
                  )}
                >
                  {done ? (
                    <Check className="size-3" aria-label="Completed" />
                  ) : active ? (
                    <Loader2 className="size-3 animate-spin" aria-label="Running" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    'truncate text-xs',
                    done || active ? 'font-medium text-ink' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
              </div>

              {metric && (
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {metric}
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {sourceStats.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 font-mono text-[11px] text-muted-foreground">
          <span className="uppercase tracking-wider text-muted-foreground/75">Sources</span>
          {sourceStats.map((source) => (
            <span
              key={source.name}
              className={cn(
                'tabular-nums',
                source.error ? 'text-amber-700' : source.count > 0 ? 'text-ink/80' : 'text-muted-foreground/60',
              )}
              title={source.error ? `${source.name}: ${source.error}` : `${source.durationMs}ms`}
            >
              {source.name} <strong className="font-medium">{source.count}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
