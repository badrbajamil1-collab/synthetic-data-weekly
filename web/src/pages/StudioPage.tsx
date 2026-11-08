import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CircleAlert,
  Clock,
  History,
  Play,
  Radio,
  Search,
  Sparkles,
  Square,
} from 'lucide-react'

import { FilterChip } from '@/components/filter-chip'
import { FollowToggle } from '@/components/follow-toggle'
import { PipelineStepper, type StepperNodeId } from '@/components/pipeline-stepper'
import { ReportItemRow } from '@/components/report-item'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  { days: 1, label: 'Last 24h' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
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
      reason: 'Collected and deduplicated — waiting for LangChain.js ranker…',
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
    <div className="min-h-[calc(100svh-76px)]">
      {/* Obsidian Live Command Console */}
      <section className="obsidian-surface border-b border-slate-800 text-white">
        <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 sm:py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 font-mono text-xs font-medium text-indigo-200">
                <Radio className="size-3.5 text-emerald-400" aria-hidden="true" />
                LangGraph.js Live Research Studio
              </span>
              <h1 className="mt-3 font-display text-3xl font-medium tracking-[-0.025em] text-white sm:text-4xl">
                Check any synthetic-data topic in real time.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Runs the 6-node <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-indigo-200">collect → clean → rank → fetch → summarise → publish</code> state machine on demand and streams each stage as it finishes.
              </p>
            </div>

            {isAdmin && (
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/90 p-1">
                <button
                  type="button"
                  onClick={() => setMode('query')}
                  className={cn(
                    'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                    mode === 'query' ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:text-white',
                  )}
                >
                  Interactive Query
                </button>
                <button
                  type="button"
                  onClick={() => setMode('weekly')}
                  className={cn(
                    'cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                    mode === 'weekly' ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:text-white',
                  )}
                >
                  Publish Weekly Brief
                </button>
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void startLiveRun()
            }}
            className="mt-7 grid gap-3 sm:grid-cols-[1fr_auto]"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  mode === 'weekly'
                    ? 'Full weekly brief across all synthetic-data sources (optional focus topic)…'
                    : 'Enter a research focus (e.g. tabular differential privacy, clinical EHR, time series)…'
                }
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-900/90 pl-11 pr-4 text-sm text-white placeholder:text-slate-400 focus-visible:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2">
              {status === 'running' ? (
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  onClick={stopRun}
                  className="h-12 border-rose-500/50 bg-rose-600 px-6 text-white hover:bg-rose-500 hover:text-white"
                >
                  <Square className="size-4 fill-current" aria-hidden="true" />
                  Stop Run
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 bg-indigo-600 px-6 text-white hover:bg-indigo-500"
                >
                  <Play className="size-4 fill-current" aria-hidden="true" />
                  {signedIn
                    ? mode === 'weekly'
                      ? 'Stream Weekly Brief'
                      : 'Run Live Check'
                    : 'Sign in to Run Live Check'}
                </Button>
              )}
            </div>
          </form>

          {/* Preset Topic Pills + Window & Source Filters */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/90 pt-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                Quick Focus:
              </span>
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
                      'cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-indigo-400 bg-indigo-500/25 text-white'
                        : 'border-slate-700/90 bg-slate-900/70 text-slate-300 hover:border-slate-500 hover:text-white',
                    )}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 p-1">
                <Clock className="ml-1.5 size-3.5 text-slate-400" aria-hidden="true" />
                {WINDOW_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => setDays(opt.days)}
                    className={cn(
                      'cursor-pointer rounded-md px-2.5 py-1 font-mono text-xs transition-colors',
                      days === opt.days
                        ? 'bg-indigo-600 font-semibold text-white'
                        : 'text-slate-300 hover:text-white',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Sources:
            </span>
            {SOURCE_OPTIONS.map((source) => {
              const checked = selectedSources.includes(source.id)
              return (
                <button
                  key={source.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggleSourceFamily(source.id)}
                  className={cn(
                    'cursor-pointer rounded-md border px-2.5 py-0.5 font-mono text-[11px] transition-colors',
                    checked
                      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-800 bg-slate-900/40 text-slate-500 hover:text-slate-300',
                  )}
                >
                  {checked ? '✓ ' : ''}{source.label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Main Workspace: Live Stepper + Streamed Results + Recent Sessions */}
      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
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
          <div className="mt-4 rounded-xl border border-amber-300/80 bg-amber-50/80 px-4 py-3 text-xs text-amber-900">
            <span className="font-semibold">Pipeline notes: </span>
            {warnings.join(' · ')}
          </div>
        )}

        {reportId && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-950">
            <span>
              Published weekly brief <strong>{reportId}</strong> to the live Cloudflare D1 archive.
            </span>
            <Button size="sm" variant="outline" onClick={() => navigate(`/brief/${reportId}`)}>
              Open Weekly Brief
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            {trendText && (
              <Card className="mb-8 rounded-2xl border border-primary/20 bg-gradient-to-br from-indigo-50/80 via-white to-teal-50/40 shadow-2xs">
                <CardContent className="p-6 sm:p-7">
                  <div className="flex items-center gap-2 text-primary">
                    <BookOpen className="size-4" aria-hidden="true" />
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider">
                      Live Synthesis · The Editorial Read
                    </span>
                  </div>
                  <p className="mt-3 font-display text-lg leading-8 text-ink sm:text-xl">
                    {trendText}
                  </p>
                </CardContent>
              </Card>
            )}

            {filteredItems.length > 0 ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-2xl font-medium text-ink">
                    {sections.length > 0
                      ? `Curated & Guarded Findings (${filteredItems.length})`
                      : scoredItems.length > 0
                        ? `Ranked Candidates (${filteredItems.length})`
                        : `Discovered Raw Candidates (${filteredItems.length})`}
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
              <div className="rounded-2xl border border-dashed border-border bg-white/80 px-6 py-14 text-center">
                <Sparkles className="mx-auto size-7 text-primary" aria-hidden="true" />
                <h2 className="mt-3 font-display text-2xl font-medium text-ink">
                  {status === 'running'
                    ? 'Collecting and deduplicating live sources…'
                    : 'Run a live topic check or inspect a saved session'}
                </h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                  {status === 'running'
                    ? 'As soon as the Clean node completes (~2 seconds), discovered papers and repositories appear here and get scored and summarised in place.'
                    : 'Pick a quick focus chip above or enter any query to execute the LangGraph.js pipeline on demand.'}
                </p>
              </div>
            )}
          </div>

          {/* Recent D1 Checkpointed Sessions */}
          <aside aria-label="Recent research sessions" className="space-y-4">
            <div className="rounded-2xl border border-border/80 bg-white p-5 shadow-2xs">
              <div className="flex items-center gap-2 text-ink">
                <History className="size-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold text-sm">Recent Live Sessions</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Checkpointed in Cloudflare D1. Click any run to inspect its telemetry and findings.
              </p>

              {sessions.length === 0 ? (
                <p className="mt-4 rounded-xl bg-background p-3 text-xs text-muted-foreground">
                  No live sessions recorded yet. Run your first check above.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {sessions.map((session) => {
                    const selected = session.id === activeSessionId
                    return (
                      <li key={session.id}>
                        <button
                          type="button"
                          onClick={() => void handleSelectSession(session.id)}
                          className={cn(
                            'w-full cursor-pointer rounded-xl border p-3 text-left transition-all',
                            selected
                              ? 'border-primary bg-primary/[0.06] ring-1 ring-primary/25'
                              : 'border-border/70 bg-background/40 hover:border-primary/35 hover:bg-white',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-ink">
                              {session.query || (session.mode === 'weekly' ? 'Weekly Brief Run' : 'All Synthetic Data')}
                            </span>
                            <Badge
                              variant={session.status === 'succeeded' ? 'secondary' : 'outline'}
                              className="text-[10px]"
                            >
                              {session.days}d
                            </Badge>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <CalendarDays className="size-3" aria-hidden="true" />
                              {formatDate(session.created_at, 'short')}
                            </span>
                            <span className="font-mono">
                              {session.stats?.cleanStats?.fresh ?? 0} items
                            </span>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  )
}
