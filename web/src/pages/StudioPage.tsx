import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  Play,
  Search,
  Square,
} from 'lucide-react'

import { FilterChip } from '@/components/filter-chip'
import { FollowToggle } from '@/components/follow-toggle'
import { PipelineStepper, type StepperNodeId } from '@/components/pipeline-stepper'
import { ReportItemRow } from '@/components/report-item'
import { Button } from '@/components/ui/button'
import {
  fetchResearchSession,
  fetchResearchSessions,
  streamResearchRun,
  type CleanStatsInfo,
  type LibraryBundle,
  type ResearchSessionDetail,
  type ResearchSessionSummary,
  type SourceStatInfo,
  type StreamedSectionItem,
} from '@/lib/api'
import { topicsFor } from '@/lib/feed'
import { formatDate, type ReportItem } from '@/lib/report'
import { navigate } from '@/lib/router'
import { sameSource, type TopicFollow, type TopicKind } from '@/lib/topics'
import { cn } from '@/lib/utils'

const PRESET_QUERIES = [
  { label: 'Differential Privacy', query: 'differential privacy tabular' },
  { label: 'Clinical & Healthcare', query: 'healthcare clinical EHR' },
  { label: 'Time-Series Synthesis', query: 'time series forecasting' },
  { label: 'Diffusion & GANs', query: 'diffusion GAN tabular' },
  { label: 'LLM Synthetic Data', query: 'LLM instruction training data' },
  { label: 'Benchmarks & Eval', query: 'fidelity utility privacy benchmark' },
]

const SOURCE_OPTIONS = [
  { id: 'arxiv', label: 'arXiv' },
  { id: 'hn', label: 'Hacker News' },
  { id: 'github', label: 'GitHub' },
  { id: 'news', label: 'Google News' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'blogs', label: 'Research Blogs' },
]

const WINDOW_OPTIONS = [
  { days: 1, label: '24h' },
  { days: 3, label: '3d' },
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
]

const NODE_ORDER: StepperNodeId[] = ['collect', 'clean', 'rank', 'fetch', 'summarise', 'publish']

function nextNodeAfter(node: StepperNodeId): StepperNodeId | null {
  const index = NODE_ORDER.indexOf(node)
  if (index < 0 || index + 1 >= NODE_ORDER.length) return null
  return NODE_ORDER[index + 1]
}

interface StudioPageProps {
  initialQuery?: string
  signedIn: boolean
  isAdmin: boolean
  onSignIn: () => void
  library: LibraryBundle
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, value: string, next: boolean) => void
}

export function StudioPage({
  initialQuery = '',
  signedIn,
  isAdmin,
  onSignIn,
  follows,
  onFollow,
}: StudioPageProps) {
  const [query, setQuery] = useState(initialQuery)
  const [days, setDays] = useState(7)
  const [mode, setMode] = useState<'query' | 'weekly'>('query')
  const [selectedSources, setSelectedSources] = useState<string[]>(SOURCE_OPTIONS.map((s) => s.id))
  const [keywordFilter, setKeywordFilter] = useState<string | null>(null)

  const [status, setStatus] = useState<'idle' | 'running' | 'succeeded' | 'failed'>('idle')
  const [activeNode, setActiveNode] = useState<StepperNodeId | null>(null)
  const [completedNodes, setCompletedNodes] = useState<StepperNodeId[]>([])
  const [error, setError] = useState<string | null>(null)

  const [sourceStats, setSourceStats] = useState<SourceStatInfo[]>([])
  const [cleanStats, setCleanStats] = useState<CleanStatsInfo | undefined>(undefined)
  const [cleanItems, setCleanItems] = useState<NonNullable<ResearchSessionDetail['result']['cleanItems']>>([])
  const [scoredItems, setScoredItems] = useState<NonNullable<ResearchSessionDetail['result']['scoredItems']>>([])
  const [sections, setSections] = useState<StreamedSectionItem[]>([])
  const [trendText, setTrendText] = useState<string>('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [reportId, setReportId] = useState<string | null>(null)

  const [sessions, setSessions] = useState<ResearchSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refreshSessions = useCallback(async () => {
    const list = await fetchResearchSessions()
    setSessions(list)
  }, [])

  useEffect(() => {
    let active = true
    void fetchResearchSessions().then((list) => {
      if (!active) return
      setSessions(list)
    })
    return () => {
      active = false
    }
  }, [])

  function toggleSourceFamily(id: string) {
    setSelectedSources((current) => {
      if (current.includes(id)) {
        return current.length > 1 ? current.filter((item) => item !== id) : current
      }
      return [...current, id]
    })
  }

  async function handleSelectSession(id: string) {
    setActiveSessionId(id)
    setError(null)
    const detail = await fetchResearchSession(id)
    if (!detail) return
    setQuery(detail.query)
    setDays(detail.days)
    setMode(detail.mode)
    setStatus(detail.status)
    setActiveNode(detail.status === 'running' ? (detail.current_node as StepperNodeId) : null)
    setCompletedNodes(detail.status === 'succeeded' ? [...NODE_ORDER] : [])
    setSourceStats(detail.result.sourceStats ?? detail.stats.sourceStats ?? [])
    setCleanStats(detail.result.cleanStats ?? detail.stats.cleanStats)
    setCleanItems(detail.result.cleanItems ?? [])
    setScoredItems(detail.result.scoredItems ?? [])
    setSections(detail.result.sections ?? [])
    setTrendText(detail.result.trend ?? '')
    setWarnings(detail.result.warnings ?? detail.stats.warnings ?? [])
    setReportId(detail.result.reportId ?? detail.stats.reportId ?? null)
    if (detail.error) setError(detail.error)
  }

  async function startLiveRun(overrideQuery?: string) {
    if (!signedIn) {
      onSignIn()
      return
    }
    const targetQuery = overrideQuery !== undefined ? overrideQuery : query
    if (overrideQuery !== undefined) setQuery(overrideQuery)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('running')
    setActiveNode('collect')
    setCompletedNodes([])
    setError(null)
    setSourceStats([])
    setCleanStats(undefined)
    setCleanItems([])
    setScoredItems([])
    setSections([])
    setTrendText('')
    setWarnings([])
    setReportId(null)

    try {
      await streamResearchRun(
        {
          mode,
          query: targetQuery,
          days,
          sourceFamilies: selectedSources,
        },
        {
          onStart: (info) => {
            setActiveSessionId(info.sessionId)
            setActiveNode('collect')
          },
          onNode: (ev) => {
            const node = ev.node as StepperNodeId
            setCompletedNodes((prev) => (prev.includes(node) ? prev : [...prev, node]))
            setActiveNode(nextNodeAfter(node))
            const snap = ev.stateSnapshot
            if (snap.sourceStats) setSourceStats(snap.sourceStats)
            if (snap.cleanStats) setCleanStats(snap.cleanStats)
            if (snap.cleanItems) setCleanItems(snap.cleanItems)
            if (snap.scoredItems) setScoredItems(snap.scoredItems)
            if (snap.sections) setSections(snap.sections)
            if (snap.trend !== undefined) setTrendText(snap.trend)
            if (snap.warnings) setWarnings(snap.warnings)
            if (snap.reportId !== undefined) setReportId(snap.reportId ?? null)
          },
          onDone: (detail) => {
            setStatus('succeeded')
            setActiveNode(null)
            setCompletedNodes([...NODE_ORDER])
            if (detail.result.sourceStats) setSourceStats(detail.result.sourceStats)
            if (detail.result.cleanStats) setCleanStats(detail.result.cleanStats)
            if (detail.result.cleanItems) setCleanItems(detail.result.cleanItems)
            if (detail.result.scoredItems) setScoredItems(detail.result.scoredItems)
            if (detail.result.sections) setSections(detail.result.sections)
            if (detail.result.trend !== undefined) setTrendText(detail.result.trend)
            if (detail.result.warnings) setWarnings(detail.result.warnings)
            if (detail.result.reportId !== undefined) setReportId(detail.result.reportId ?? null)
            void refreshSessions()
          },
          onError: (msg) => {
            setStatus('failed')
            setActiveNode(null)
            setError(msg)
            void refreshSessions()
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle')
        setActiveNode(null)
        return
      }
      setStatus('failed')
      setActiveNode(null)
      setError(err instanceof Error ? err.message : 'Live research run failed.')
    }
  }

  function stopRun() {
    abortRef.current?.abort()
    setStatus('idle')
    setActiveNode(null)
  }

  const displayItems = useMemo<ReportItem[]>(() => {
    if (sections.length > 0) {
      return sections.map((entry, idx) => ({
        id: `${entry.item.url}-${idx}`,
        title: entry.item.title,
        url: entry.item.url,
        source: entry.item.source,
        published: entry.item.published,
        score: entry.item.score ?? entry.item.well7_fit,
        well7_fit: entry.item.well7_fit,
        reason: entry.item.reason,
        summary: entry.summary.summary,
        section: entry.section,
        position: idx + 1,
      }))
    }
    if (scoredItems.length > 0) {
      return scoredItems.map((item, idx) => ({
        id: `${item.url}-${idx}`,
        title: item.title,
        url: item.url,
        source: item.source,
        published: item.published,
        score: item.score ?? item.well7_fit,
        well7_fit: item.well7_fit,
        reason: item.reason,
        summary: item.snippet,
        section: idx < 4 ? 'top' : item.source === 'GitHub' ? 'tool' : 'worth',
        position: idx + 1,
      }))
    }
    return cleanItems.map((item, idx) => ({
      id: `${item.url}-${idx}`,
      title: item.title,
      url: item.url,
      source: item.source,
      published: item.published,
      score: 0,
      well7_fit: null,
      reason: 'Collected and deduplicated — waiting for ranker…',
      summary: item.snippet,
      section: 'top',
      position: idx + 1,
    }))
  }, [sections, scoredItems, cleanItems])

  const filteredItems = useMemo(() => {
    if (!keywordFilter) return displayItems
    return displayItems.filter((item) => topicsFor(item).includes(keywordFilter))
  }, [displayItems, keywordFilter])

  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      {/* Quiet Editorial Header & Search Controls */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl">
            Live research studio
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Run the 6-node LangGraph.js pipeline across live sources and inspect each stage as it finishes.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-white p-1">
            <button
              type="button"
              onClick={() => setMode('query')}
              className={cn(
                'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'query' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-ink',
              )}
            >
              Interactive query
            </button>
            <button
              type="button"
              onClick={() => setMode('weekly')}
              className={cn(
                'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'weekly' ? 'bg-ink text-white' : 'text-muted-foreground hover:text-ink',
              )}
            >
              Publish weekly brief
            </button>
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void startLiveRun()
        }}
        className="mt-6 flex flex-col gap-2.5 sm:flex-row"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              mode === 'weekly'
                ? 'Full weekly brief across all synthetic-data sources (optional focus topic)…'
                : 'Enter a research focus (e.g. tabular differential privacy, clinical EHR, time series)…'
            }
            className="h-12 w-full rounded-xl border border-border/90 bg-white pl-11 pr-4 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {status === 'running' ? (
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={stopRun}
            className="h-12 rounded-xl border-destructive/40 px-6 text-destructive hover:bg-destructive/5"
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
            Stop run
          </Button>
        ) : (
          <Button
            type="submit"
            size="lg"
            variant="ink"
            className="h-12 rounded-xl px-6"
          >
            <Play className="size-3.5 fill-current" aria-hidden="true" />
            {signedIn
              ? mode === 'weekly'
                ? 'Stream weekly brief'
                : 'Run live check'
              : 'Sign in to run live check'}
          </Button>
        )}
      </form>

      {/* Quiet Focus & Scope Controls */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Focus:</span>
          {PRESET_QUERIES.map((preset) => {
            const active = query.toLowerCase() === preset.query.toLowerCase()
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setQuery(preset.query)
                  if (signedIn && status !== 'running') {
                    void startLiveRun(preset.query)
                  }
                }}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 transition-colors',
                  active
                    ? 'border-primary/45 bg-primary/10 font-medium text-primary'
                    : 'border-border/75 bg-white text-ink/80 hover:border-primary/30 hover:text-primary',
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Window selector */}
          <div className="inline-flex items-center gap-1 rounded-lg border border-border/80 bg-white p-0.5 font-mono text-[11px]">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                onClick={() => setDays(opt.days)}
                className={cn(
                  'cursor-pointer rounded-md px-2 py-1 transition-colors',
                  days === opt.days
                    ? 'bg-secondary font-semibold text-ink'
                    : 'text-muted-foreground hover:text-ink',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Compact Source Toggles */}
          <div className="flex flex-wrap items-center gap-1">
            {SOURCE_OPTIONS.map((source) => {
              const checked = selectedSources.includes(source.id)
              return (
                <button
                  key={source.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggleSourceFamily(source.id)}
                  className={cn(
                    'cursor-pointer rounded-md border px-2 py-1 font-mono text-[11px] transition-colors',
                    checked
                      ? 'border-border/80 bg-white text-ink'
                      : 'border-transparent bg-transparent text-muted-foreground/55 hover:text-muted-foreground',
                  )}
                >
                  {source.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Stepper Rail */}
      <div className="mt-6">
        <PipelineStepper
          status={status}
          activeNode={activeNode}
          completedNodes={completedNodes}
          sourceStats={sourceStats}
          cleanStats={cleanStats}
          scoredCount={scoredItems.length}
          fetchedCount={sections.length}
          sectionCount={sections.length}
          reportId={reportId}
        />
      </div>

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Run did not complete</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-300/80 bg-amber-50/70 px-4 py-2.5 text-xs text-amber-900">
          <span className="font-medium">Pipeline notes: </span>
          {warnings.join(' · ')}
        </div>
      )}

      {reportId && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/8 px-5 py-3.5 text-sm text-emerald-950">
          <span>
            Published weekly brief <strong>{reportId}</strong> to the Cloudflare D1 archive.
          </span>
          <Button size="sm" variant="outline" onClick={() => navigate(`/brief/${reportId}`)}>
            Open weekly brief
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          {trendText && (
            <div className="mb-8 border-y border-border/80 py-6">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Live synthesis
              </p>
              <p className="mt-2 max-w-[68ch] font-display text-xl leading-8 text-ink/90">
                {trendText}
              </p>
            </div>
          )}

          {filteredItems.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-medium text-ink">
                  {sections.length > 0
                    ? `Curated findings (${filteredItems.length})`
                    : scoredItems.length > 0
                      ? `Ranked candidates (${filteredItems.length})`
                      : `Discovered candidates (${filteredItems.length})`}
                </h2>
                {keywordFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setKeywordFilter(null)}>
                    Clear "{keywordFilter}" filter
                  </Button>
                )}
              </div>

              {filteredItems.map((item, idx) => {
                const itemTopics = topicsFor(item)
                return (
                  <ReportItemRow
                    key={item.id}
                    item={item}
                    rank={idx + 1}
                    tags={
                      itemTopics.length > 0
                        ? itemTopics.map((label) => (
                            <FilterChip
                              key={label}
                              label={label}
                              active={keywordFilter === label}
                              onToggle={() =>
                                setKeywordFilter((curr) => (curr === label ? null : label))
                              }
                              followed={
                                follows?.some((f) => f.kind === 'topic' && f.value === label) ??
                                false
                              }
                              onFollowToggle={
                                onFollow ? (next) => onFollow('topic', label, next) : undefined
                              }
                            />
                          ))
                        : undefined
                    }
                    followControl={
                      onFollow ? (
                        <FollowToggle
                          kind="source"
                          value={item.source}
                          followed={
                            follows?.some(
                              (f) => f.kind === 'source' && sameSource(f.value, item.source),
                            ) ?? false
                          }
                          onToggle={(kind, value, next) => onFollow(kind, value, next)}
                        />
                      ) : undefined
                    }
                  />
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-white/70 px-6 py-14 text-center">
              <h2 className="font-display text-2xl font-medium text-ink">
                {status === 'running'
                  ? 'Collecting and deduplicating live sources…'
                  : 'Run a live topic check or select a saved session'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {status === 'running'
                  ? 'Discovered papers and repositories appear here as soon as the Clean node finishes.'
                  : 'Choose a focus preset above or enter any query to run the pipeline on demand.'}
              </p>
            </div>
          )}
        </div>

        {/* Recent D1 Checkpointed Sessions */}
        <aside aria-label="Recent research sessions">
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent sessions
          </h3>
          {sessions.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No live sessions recorded yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border/70 rounded-2xl border border-border/75 bg-white">
              {sessions.map((session) => {
                const selected = session.id === activeSessionId
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => void handleSelectSession(session.id)}
                      className={cn(
                        'w-full cursor-pointer px-4 py-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl',
                        selected
                          ? 'bg-primary/[0.06]'
                          : 'hover:bg-secondary/50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-xs',
                            selected ? 'font-semibold text-primary' : 'font-medium text-ink',
                          )}
                        >
                          {session.query || (session.mode === 'weekly' ? 'Weekly brief run' : 'All synthetic data')}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                          {session.days}d
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="size-3" aria-hidden="true" />
                          {formatDate(session.created_at, 'short')}
                        </span>
                        <span className="font-mono tabular-nums">
                          {session.stats?.cleanStats?.fresh ?? 0} items
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
      </div>
    </section>
  )
}
