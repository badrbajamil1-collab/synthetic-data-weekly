import {
  CheckCircle2,
  CircleDot,
  Database,
  FileSearch,
  Filter,
  Loader2,
  Sparkles,
  Trophy,
  UploadCloud,
} from 'lucide-react'

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
  subtitle: string
  icon: typeof Database
}> = [
  { id: 'collect', label: '1. Collect', subtitle: 'arXiv, HN, GitHub, RSS', icon: Database },
  { id: 'clean', label: '2. Clean & Dedupe', subtitle: 'Normalize & filter URLs', icon: Filter },
  { id: 'rank', label: '3. Rank (LLM)', subtitle: 'Score relevance & Well7 fit', icon: Trophy },
  { id: 'fetch', label: '4. Fetch Text', subtitle: 'Pull full abstracts & pages', icon: FileSearch },
  { id: 'summarise', label: '5. Summarise', subtitle: 'Citation-guarded synthesis', icon: Sparkles },
  { id: 'publish', label: '6. Checkpoint', subtitle: 'Persist to Cloudflare D1', icon: UploadCloud },
]

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
        return `${total} raw items`
      }
      case 'clean':
        if (!cleanStats) return null
        return `${cleanStats.fresh} fresh (-${cleanStats.duplicatesRemoved} dup)`
      case 'rank':
        return scoredCount > 0 ? `${scoredCount} scored` : null
      case 'fetch':
        return fetchedCount > 0 ? `${fetchedCount} texts pulled` : null
      case 'summarise':
        return sectionCount > 0 ? `${sectionCount} guarded summaries` : null
      case 'publish':
        if (reportId) return `Published ${reportId}`
        return completedNodes.includes('publish') ? 'Saved to D1' : null
    }
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-white p-5 shadow-2xs sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              'inline-flex size-2.5 rounded-full',
              status === 'running' && 'animate-ping bg-primary',
              status === 'succeeded' && 'bg-emerald-500',
              status === 'failed' && 'bg-destructive',
              status === 'idle' && 'bg-muted-foreground/40',
            )}
          />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-ink">
            LangGraph.js StateGraph Telemetry
          </h2>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {status === 'running' && activeNode
            ? `Executing node: ${activeNode}…`
            : status === 'succeeded'
              ? 'All graph nodes completed'
              : status === 'failed'
                ? 'Run interrupted'
                : 'Ready to execute'}
        </span>
      </div>

      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {NODE_STEPS.map((step) => {
          const done = completedNodes.includes(step.id)
          const active = status === 'running' && activeNode === step.id && !done
          const metric = metricFor(step.id)
          const Icon = step.icon

          return (
            <li
              key={step.id}
              className={cn(
                'relative flex flex-col justify-between rounded-xl border p-3.5 transition-all',
                done && 'border-emerald-500/35 bg-emerald-500/[0.04]',
                active && 'border-primary bg-primary/[0.06] ring-2 ring-primary/20',
                !done && !active && 'border-border/70 bg-background/50 opacity-75',
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'grid size-7 place-items-center rounded-lg border',
                      done && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
                      active && 'border-primary/30 bg-primary/15 text-primary',
                      !done && !active && 'border-border bg-white text-muted-foreground',
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  {done ? (
                    <CheckCircle2 className="size-4 text-emerald-600" aria-label="Completed" />
                  ) : active ? (
                    <Loader2 className="size-4 animate-spin text-primary" aria-label="Running" />
                  ) : (
                    <CircleDot className="size-4 text-muted-foreground/40" aria-hidden="true" />
                  )}
                </div>
                <p className="mt-2.5 font-semibold text-xs text-ink">{step.label}</p>
                <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{step.subtitle}</p>
              </div>

              {metric && (
                <p
                  className={cn(
                    'mt-3 rounded-md px-2 py-1 font-mono text-[11px] font-medium tabular-nums',
                    done ? 'bg-emerald-500/10 text-emerald-800' : 'bg-primary/10 text-primary',
                  )}
                >
                  {metric}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {sourceStats.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3.5">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Source Collectors:
          </span>
          {sourceStats.map((source) => (
            <span
              key={source.name}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[11px]',
                source.error
                  ? 'border-amber-400/50 bg-amber-50 text-amber-800'
                  : source.count > 0
                    ? 'border-border bg-background text-ink'
                    : 'border-border/60 bg-background/40 text-muted-foreground',
              )}
              title={source.error ? `${source.name}: ${source.error}` : `${source.durationMs}ms`}
            >
              <span>{source.name}</span>
              <span className="font-semibold tabular-nums">{source.count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
