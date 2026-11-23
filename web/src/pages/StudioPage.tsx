import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  Loader2,
  Play,
  Search,
  Square,
} from 'lucide-react'

import { EditorialTakeaway } from '@/components/editorial-takeaway'
import { FilterChip } from '@/components/filter-chip'
import { FollowToggle } from '@/components/follow-toggle'
import { Link } from '@/components/link'
import { PaperActions } from '@/components/paper-actions'
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
import { navigate, useLocationSearch } from '@/lib/router'
import { sameFollow, type TopicFollow, type TopicKind } from '@/lib/topics'
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

function stableItemId(url: string): string {
  let hash = 2166136261
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `live-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

interface StudioPageProps {
  signedIn: boolean
  isAdmin: boolean
  onSignIn: () => void
  library: LibraryBundle
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, value: string, next: boolean) => void
}

export function StudioPage({
  signedIn,
  isAdmin,
  onSignIn,
  library,
  follows,
  onFollow,
}: StudioPageProps) {
  const locationSearch = useLocationSearch()
  const urlParams = useMemo(() => new URLSearchParams(locationSearch), [locationSearch])
  const urlQuery = urlParams.get('q') ?? ''
  const shouldAutoRun = urlParams.get('run') === '1'

  const [query, setQuery] = useState(() => urlQuery)
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
  const [fetchedCount, setFetchedCount] = useState(0)
  const [sections, setSections] = useState<StreamedSectionItem[]>([])
  const [trendText, setTrendText] = useState<string>('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [reportId, setReportId] = useState<string | null>(null)

  const [sessions, setSessions] = useState<ResearchSessionSummary[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const sessionReqRef = useRef(0)
  const autoRunHandledRef = useRef(false)
  const queryInputRef = useRef<HTMLInputElement>(null)
  const queryInputId = useId()

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

  // Abort any live SSE stream if the user navigates away from /studio.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
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
    abortRef.current?.abort()
    sessionReqRef.current += 1
    const reqId = sessionReqRef.current

    setLoadingSessionId(id)
    setError(null)
    setKeywordFilter(null)

    const detail = await fetchResearchSession(id)
    if (reqId !== sessionReqRef.current) return
    setLoadingSessionId(null)

    if (!detail) {
      setError('Could not load that saved search session. Try selecting it again.')
      return
    }

    setActiveSessionId(id)
    setQuery(detail.query)
    setDays(detail.days)
    setMode(detail.mode)
    setStatus(detail.status)
    setActiveNode(detail.status === 'running' ? (detail.current_node as StepperNodeId) : null)
    setCompletedNodes(detail.status === 'succeeded' ? [...NODE_ORDER] : [])
    setSourceStats(detail.result?.sourceStats ?? detail.stats?.sourceStats ?? [])
    setCleanStats(detail.result?.cleanStats ?? detail.stats?.cleanStats)
    setCleanItems(detail.result?.cleanItems ?? [])
    setScoredItems(detail.result?.scoredItems ?? [])
    setFetchedCount(detail.stats?.fetchedCount ?? detail.result?.sections?.length ?? 0)
    setSections(detail.result?.sections ?? [])
    setTrendText(detail.result?.trend ?? '')
    setWarnings(detail.result?.warnings ?? detail.stats?.warnings ?? [])
    setReportId(detail.result?.reportId ?? detail.stats?.reportId ?? null)
    if (detail.error) setError(detail.error)
  }

  const startLiveRun = useCallback(async (overrideQuery?: string) => {
    if (!signedIn) {
      onSignIn()
      return
    }
    const targetQuery = overrideQuery !== undefined ? overrideQuery : query
    if (overrideQuery !== undefined) setQuery(overrideQuery)

    sessionReqRef.current += 1
    setLoadingSessionId(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('running')
    setActiveNode('collect')
    setCompletedNodes([])
    setKeywordFilter(null)
    setError(null)
    setSourceStats([])
    setCleanStats(undefined)
    setCleanItems([])
    setScoredItems([])
    setFetchedCount(0)
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
            if (abortRef.current !== controller) return
            setActiveSessionId(info.sessionId)
            setActiveNode('collect')
          },
          onNode: (ev) => {
            if (abortRef.current !== controller) return
            const node = ev.node as StepperNodeId
            setCompletedNodes((prev) => (prev.includes(node) ? prev : [...prev, node]))
            setActiveNode(nextNodeAfter(node))
            const snap = ev.stateSnapshot
            if (snap?.sourceStats) setSourceStats(snap.sourceStats)
            if (snap?.cleanStats) setCleanStats(snap.cleanStats)
            if (snap?.cleanItems) setCleanItems(snap.cleanItems)
            if (snap?.scoredItems) setScoredItems(snap.scoredItems)
            if (node === 'fetch') {
              const reported = Number(ev.summary?.fetched ?? ev.summary?.fetchedCount ?? ev.summary?.count ?? 0)
              if (reported > 0) setFetchedCount(reported)
            }
            if (snap?.sections) {
              setSections(snap.sections)
              setFetchedCount((prev) => Math.max(prev, snap.sections?.length ?? 0))
            }
            if (snap?.trend !== undefined) setTrendText(snap.trend)
            if (snap?.warnings) setWarnings(snap.warnings)
            if (snap?.reportId !== undefined) setReportId(snap.reportId ?? null)
          },
          onDone: (detail) => {
            if (abortRef.current !== controller) return
            setStatus('succeeded')
            setActiveNode(null)
            setCompletedNodes([...NODE_ORDER])
            if (detail.result?.sourceStats) setSourceStats(detail.result.sourceStats)
            if (detail.result?.cleanStats) setCleanStats(detail.result.cleanStats)
            if (detail.result?.cleanItems) setCleanItems(detail.result.cleanItems)
            if (detail.result?.scoredItems) setScoredItems(detail.result.scoredItems)
            if (detail.stats?.fetchedCount) setFetchedCount(detail.stats.fetchedCount)
            if (detail.result?.sections) {
              setSections(detail.result.sections)
              setFetchedCount((prev) => Math.max(prev, detail.result.sections?.length ?? 0))
            }
            if (detail.result?.trend !== undefined) setTrendText(detail.result.trend)
            if (detail.result?.warnings) setWarnings(detail.result.warnings)
            if (detail.result?.reportId !== undefined) setReportId(detail.result.reportId ?? null)
            void refreshSessions()
          },
          onError: (msg) => {
            if (abortRef.current !== controller) return
            setStatus('failed')
            setActiveNode(null)
            setError(msg)
            void refreshSessions()
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (abortRef.current !== controller) return
      if (controller.signal.aborted) {
        setStatus('idle')
        setActiveNode(null)
        return
      }
      setStatus('failed')
      setActiveNode(null)
      setError(err instanceof Error ? err.message : 'Live search failed.')
    }
  }, [signedIn, onSignIn, query, mode, days, selectedSources, refreshSessions])

  // Auto-run once when arriving from Landing's explicit "Search live" submit (?q=...&run=1).
  useEffect(() => {
    const trimmed = urlQuery.trim()
    if (!shouldAutoRun || !trimmed || autoRunHandledRef.current) return
    if (!signedIn) return
    autoRunHandledRef.current = true
    navigate(`/studio?q=${encodeURIComponent(trimmed)}`, { replace: true })
    queueMicrotask(() => {
      if (mountedRef.current) {
        void startLiveRun(trimmed)
      }
    })
  }, [shouldAutoRun, urlQuery, signedIn, startLiveRun])

  function stopRun() {
    abortRef.current?.abort()
    setStatus('idle')
    setActiveNode(null)
  }

  const displayItems = useMemo<ReportItem[]>(() => {
    if (sections.length > 0) {
      return sections.map((entry, idx) => ({
        id: stableItemId(entry.item.url),
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
        id: stableItemId(item.url),
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
      id: stableItemId(item.url),
      title: item.title,
      url: item.url,
      source: item.source,
      published: item.published,
      score: 0,
      well7_fit: null,
      reason: '',
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
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-[-0.02em] text-primary sm:text-4xl">
            Live topic search
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Search across arXiv, GitHub, Hacker News, Google News, Reddit, and research blogs for recent synthetic-data papers and tools.
          </p>
        </div>

        {isAdmin && (
          <div
            role="group"
            aria-label="Search mode"
            className="flex items-center gap-1 rounded-full border border-input bg-[#fffdf9] p-1"
          >
            <button
              type="button"
              aria-pressed={mode === 'query'}
              onClick={() => setMode('query')}
              className={cn(
                'touch-target min-h-8 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === 'query' ? 'bg-primary text-[#faf4ec]' : 'text-muted-foreground hover:text-primary',
              )}
            >
              Topic search
            </button>
            <button
              type="button"
              aria-pressed={mode === 'weekly'}
              onClick={() => setMode('weekly')}
              className={cn(
                'touch-target min-h-8 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                mode === 'weekly' ? 'bg-primary text-[#faf4ec]' : 'text-muted-foreground hover:text-primary',
              )}
            >
              Publish weekly brief
            </button>
          </div>
        )}
      </div>

      <search className="mt-6">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void startLiveRun()
          }}
          className="flex flex-col gap-2.5 sm:flex-row"
        >
          <div className="relative flex-1">
            <label htmlFor={queryInputId} className="sr-only">
              Search synthetic data topics across live sources
            </label>
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              ref={queryInputRef}
              id={queryInputId}
              name="q"
              type="search"
              value={query}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                mode === 'weekly'
                  ? 'Full weekly brief across all synthetic-data sources (optional focus topic)…'
                  : 'Search a topic (e.g. DP, clinical EHR, time series)…'
              }
              className="h-12 w-full rounded-xl border border-input bg-[#fffdf9] pl-11 pr-4 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {status === 'running' ? (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={stopRun}
              className="h-12 border-destructive/40 px-6 text-destructive hover:border-destructive hover:bg-destructive/5 hover:text-destructive"
            >
              <Square className="size-3.5 fill-current" aria-hidden="true" />
              Stop search
            </Button>
          ) : (
            <Button
              type="submit"
              size="lg"
              variant="amber"
              className="h-12 px-6"
            >
              <Play className="size-3.5 fill-current" aria-hidden="true" />
              {signedIn
                ? mode === 'weekly'
                  ? 'Publish weekly brief'
                  : 'Search now'
                : 'Sign in to search'}
            </Button>
          )}
        </form>

        {/* Structured Focus & Scope Controls */}
        <div className="mt-4 space-y-3 rounded-2xl border border-border bg-[#fffdf9]/85 p-4 text-xs shadow-[0_6px_18px_rgba(14,62,64,0.04)]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-muted-foreground">Presets</span>
            <div role="group" aria-label="Preset topics" className="flex flex-wrap items-center gap-1.5">
              {PRESET_QUERIES.map((preset) => {
                const active = query.trim().toLowerCase() === preset.query.toLowerCase()
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={active}
                    disabled={status === 'running'}
                    onClick={() => {
                      setQuery(preset.query)
                      queryInputRef.current?.focus()
                    }}
                    className={cn(
                      'touch-target min-h-8 cursor-pointer rounded-full border px-3 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
                      active
                        ? 'border-primary bg-primary text-[#faf4ec]'
                        : 'border-input bg-[#fffdf9] text-ink hover:border-primary hover:text-primary',
                    )}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <span className="font-bold text-muted-foreground">Window</span>
              <div
                role="group"
                aria-label="Time window"
                className="inline-flex items-center gap-0.5 rounded-full border border-input bg-[#fffdf9] p-0.5 font-mono text-xs"
              >
                {WINDOW_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    aria-pressed={days === opt.days}
                    onClick={() => setDays(opt.days)}
                    className={cn(
                      'touch-target min-h-8 cursor-pointer rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      days === opt.days
                        ? 'bg-primary font-semibold text-[#faf4ec]'
                        : 'text-muted-foreground hover:text-primary',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-muted-foreground">Sources</span>
              <div role="group" aria-label="Research sources" className="flex flex-wrap items-center gap-1.5">
                {SOURCE_OPTIONS.map((source) => {
                  const checked = selectedSources.includes(source.id)
                  return (
                    <button
                      key={source.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleSourceFamily(source.id)}
                      className={cn(
                        'touch-target min-h-8 cursor-pointer rounded-full border px-3 py-1 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        checked
                          ? 'border-primary bg-primary font-medium text-[#faf4ec]'
                          : 'border-input bg-[#fffdf9] text-muted-foreground hover:border-primary hover:text-primary',
                      )}
                    >
                      {source.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </search>

      {/* Progress Rail — shown while searching or viewing a session */}
      {status !== 'idle' && (
        <div className="mt-6">
          <PipelineStepper
            status={status}
            activeNode={activeNode}
            completedNodes={completedNodes}
            sourceStats={sourceStats}
            cleanStats={cleanStats}
            scoredCount={scoredItems.length}
            fetchedCount={fetchedCount}
            sectionCount={sections.length}
            reportId={reportId}
          />
        </div>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Search did not complete</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div role="status" className="mt-4 rounded-xl border border-[#e5bc84] bg-[#fdf3e2] px-4 py-2.5 text-xs text-[#6e3c0a]">
          <span className="font-semibold">Note: </span>
          {warnings.join(' — ')}
        </div>
      )}

      {reportId && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#a3d9be] bg-[#e7f5ee] px-5 py-3.5 text-sm text-[#0e6245]">
          <span>
            Published weekly brief <strong>{reportId}</strong> to the archive.
          </span>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/brief/${reportId}`}>
              Open weekly brief
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="min-w-0">
          {trendText && (
            <div className="mb-6">
              <EditorialTakeaway text={trendText} label="Key takeaway" />
            </div>
          )}

          {filteredItems.length > 0 ? (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-2xl font-medium text-primary">
                  Results ({filteredItems.length})
                </h2>
                {keywordFilter && (
                  <Button variant="ghost" size="sm" onClick={() => setKeywordFilter(null)}>
                    Clear &ldquo;{keywordFilter}&rdquo; filter
                  </Button>
                )}
              </div>

              {filteredItems.map((item, idx) => {
                const itemTopics = topicsFor(item)
                const savedState = library.savedById.get(item.id)
                return (
                  <ReportItemRow
                    key={item.id}
                    item={item}
                    rank={idx + 1}
                    headingLevel="h3"
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
                                follows?.some((f) => sameFollow(f, 'topic', label)) ?? false
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
                            follows?.some((f) => sameFollow(f, 'source', item.source)) ?? false
                          }
                          onToggle={(kind, value, next) => onFollow(kind, value, next)}
                        />
                      ) : undefined
                    }
                    actions={
                      signedIn ? (
                        <PaperActions
                          readLater={savedState?.read_later === 1}
                          important={savedState?.important === 1}
                          onToggle={(field) => void library.togglePaper(item.id, field, item)}
                        />
                      ) : undefined
                    }
                  />
                )
              })}
            </div>
          ) : displayItems.length > 0 && keywordFilter ? (
            <div className="rounded-2xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
              <h2 className="font-display text-xl font-medium text-primary">
                No results match &ldquo;{keywordFilter}&rdquo;
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                {displayItems.length} {displayItems.length === 1 ? 'result is' : 'results are'} hidden by this topic filter.
              </p>
              <Button className="mt-5" variant="outline" size="sm" onClick={() => setKeywordFilter(null)}>
                Clear &ldquo;{keywordFilter}&rdquo; filter
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-14 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
              <h2 className="font-display text-2xl font-medium text-primary">
                {status === 'running'
                  ? 'Searching live sources…'
                  : 'Search any topic or select a recent search'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                {status === 'running'
                  ? 'Papers and repositories appear here as soon as they are collected.'
                  : 'Pick a preset topic above or enter a keyword, choose your window and sources, then run a live search.'}
              </p>
            </div>
          )}
        </div>

        {/* Recent Searches */}
        <aside aria-label="Recent searches">
          <h2 className="text-sm font-bold text-primary">
            Recent searches
          </h2>
          {sessions.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              No recent searches yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-[#fffdf9] shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
              {sessions.map((session) => {
                const selected = session.id === activeSessionId
                const loadingThis = session.id === loadingSessionId
                const itemCount = session.stats?.cleanStats?.fresh ?? 0
                const statusLabel =
                  session.status === 'failed'
                    ? 'Failed'
                    : session.status === 'running'
                      ? 'Running'
                      : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      aria-current={selected ? 'true' : undefined}
                      aria-busy={loadingThis || undefined}
                      onClick={() => void handleSelectSession(session.id)}
                      className={cn(
                        'touch-target w-full cursor-pointer px-4 py-3 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        selected
                          ? 'bg-[#e1f0ee]'
                          : 'hover:bg-secondary/75',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-xs',
                            selected ? 'font-semibold text-primary' : 'font-medium text-ink',
                          )}
                        >
                          {session.query || (session.mode === 'weekly' ? 'Weekly brief' : 'All synthetic data')}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground tabular-nums">
                          {loadingThis && <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />}
                          {session.days}d
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="size-3" aria-hidden="true" />
                          {formatDate(session.created_at, 'short')}
                        </span>
                        <span
                          className={cn(
                            'font-mono tabular-nums',
                            session.status === 'failed' && 'font-medium text-destructive',
                          )}
                        >
                          {statusLabel}
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
