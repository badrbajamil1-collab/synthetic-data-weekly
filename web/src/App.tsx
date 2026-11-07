import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Show, UserButton, useAuth, useClerk } from '@clerk/react'
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import { FeedFilterBar, FeedList, FeedSidebar, KeywordStrip } from '@/components/feed-panel'
import { LandingInfo, SignInTeaser } from '@/components/landing-sections'
import { Library } from '@/components/library'
import { NewsList } from '@/components/news-list'
import { SignalVisual } from '@/components/signal-visual'
import { authHeaders, errorText, getJson, saveState, setApiTokenGetter, type LibraryEntry, type Me } from '@/lib/api'
import { filterItems, keywordCounts, sectionCounts, type FeedFilters, type FeedSection, type FeedView } from '@/lib/feed'
import { BlurFade } from '@/components/ui/blur-fade'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { briefTitle, formatDate, type Report, type ReportItem } from '@/lib/report'

const emptyFilters: FeedFilters = { query: '', section: 'all', keyword: null, view: 'all' }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The archive could not be loaded. Try again.'
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [reports, setReports] = useState<Report[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  const [items, setItems] = useState<ReportItem[]>([])
  const [filters, setFilters] = useState<FeedFilters>(emptyFilters)
  const [archiveLoading, setArchiveLoading] = useState(true)
  const [reportLoading, setReportLoading] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [archiveRetry, setArchiveRetry] = useState(0)
  const [reportRetry, setReportRetry] = useState(0)

  // Clerk session → every signed-in request carries a fresh session JWT.
  const { getToken, userId, isLoaded } = useAuth()
  const clerk = useClerk()
  const getTokenRef = useRef(getToken)
  useEffect(() => {
    getTokenRef.current = getToken
  }, [getToken])

  useEffect(() => {
    setApiTokenGetter(() => getTokenRef.current())
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadArchive() {
      setArchiveLoading(true)
      setArchiveError(null)
      try {
        const response = await fetch('/api/reports', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(response.status === 401
            ? 'Your session has expired. Sign in again, then reload this page.'
            : `The report archive returned an error (${response.status}). Try again.`)
        }
        const data = await response.json() as { reports?: Report[] }
        const nextReports = data.reports ?? []
        setReports(nextReports)
        setSelectedId((current) => current ?? nextReports[0]?.id ?? null)
      } catch (error) {
        if (!controller.signal.aborted) setArchiveError(getErrorMessage(error))
      } finally {
        if (!controller.signal.aborted) setArchiveLoading(false)
      }
    }

    void loadArchive()
    return () => controller.abort()
  }, [archiveRetry])

  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()

    async function loadReport(id: string) {
      setReportLoading(true)
      setReportError(null)
      try {
        const [reportResponse, itemsResponse] = await Promise.all([
          fetch(`/api/reports/${id}`, { signal: controller.signal }),
          fetch(`/api/reports/${id}/items`, { signal: controller.signal }),
        ])
        if (!reportResponse.ok || !itemsResponse.ok) {
          throw new Error('This brief could not be loaded. Try again or choose another week.')
        }
        const [reportData, itemsData] = await Promise.all([
          reportResponse.json() as Promise<{ report: Report }>,
          itemsResponse.json() as Promise<{ items?: ReportItem[] }>,
        ])
        setSelectedReport(reportData.report)
        setItems(itemsData.items ?? [])
      } catch (error) {
        if (!controller.signal.aborted) setReportError(getErrorMessage(error))
      } finally {
        if (!controller.signal.aborted) setReportLoading(false)
      }
    }

    void loadReport(selectedId)
    return () => controller.abort()
  }, [selectedId, reportRetry])

  const sourceCount = useMemo(() => new Set(items.map((item) => item.source)).size, [items])
  const averageScore = items.length
    ? items.reduce((total, item) => total + Number(item.score || 0), 0) / items.length
    : 0

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      const data = await getJson<{ items: LibraryEntry[] }>('/api/my/library')
      setLibrary(data?.items ?? [])
    } catch (error) {
      setLibraryError(errorText(error))
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  // /api/me follows the Clerk session: signing in or out re-keys the identity
  // and re-loads (or clears) the private library.
  useEffect(() => {
    if (!isLoaded) return
    let active = true

    async function loadMe() {
      if (!userId) {
        setMe(null)
        setLibrary([])
      } else {
        try {
          const user = await getJson<Me>('/api/me')
          if (active) {
            setMe(user)
            if (user) void loadLibrary()
          }
        } catch {
          if (active) setMe(null)
        }
      }
      if (active) setSessionChecked(true)
    }

    void loadMe()
    return () => {
      active = false
    }
  }, [isLoaded, userId, loadLibrary])

  const savedById = useMemo(() => new Map(library.map((entry) => [entry.id, entry])), [library])
  const visibleItems = useMemo(() => filterItems(items, filters, savedById), [items, filters, savedById])
  const keywords = useMemo(() => keywordCounts(items), [items])
  const totals = useMemo(() => sectionCounts(items), [items])
  const viewCounts = useMemo<Record<FeedView, number>>(() => ({
    all: items.length,
    read_later: items.filter((item) => savedById.get(item.id)?.read_later === 1).length,
    important: items.filter((item) => savedById.get(item.id)?.important === 1).length,
  }), [items, savedById])

  async function togglePaper(itemId: string, field: 'read_later' | 'important') {
    const current = savedById.get(itemId)
    setActionError(null)
    try {
      await saveState(itemId, {
        read_later: field === 'read_later' ? current?.read_later !== 1 : current?.read_later === 1,
        important: field === 'important' ? current?.important !== 1 : current?.important === 1,
      })
      await loadLibrary()
    } catch (error) {
      setActionError(errorText(error))
    }
  }

  async function saveNote(itemId: string, note: string) {
    setActionError(null)
    try {
      await saveState(itemId, { note })
      await loadLibrary()
    } catch (error) {
      setActionError(errorText(error))
    }
  }

  async function runPipeline() {
    setRunning(true)
    setActionError(null)
    try {
      const response = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { Accept: 'application/json', ...(await authHeaders()) },
      })
      const body = (await response.json()) as { status?: string; error?: string }
      if (!response.ok || body.status !== 'succeeded') {
        throw new Error(body.error ?? `The run failed (${response.status}). Try again in a moment.`)
      }
      window.location.reload()
    } catch (error) {
      setActionError(errorText(error))
    } finally {
      setRunning(false)
    }
  }

  function openReport(id: string) {
    setSelectedId(id)
    // No explicit behavior: CSS scroll-behavior applies, and index.css turns it
    // off under prefers-reduced-motion.
    window.setTimeout(() => document.getElementById('report')?.scrollIntoView(), 0)
  }

  function selectLatest() {
    if (reports[0]) setSelectedId(reports[0].id)
  }

  function setQuery(query: string) {
    setFilters((current) => ({ ...current, query }))
  }

  function setSection(section: FeedSection) {
    setFilters((current) => ({ ...current, section }))
  }

  function setView(view: FeedView) {
    setFilters((current) => ({ ...current, view }))
  }

  function toggleKeyword(label: string) {
    setFilters((current) => ({ ...current, keyword: current.keyword === label ? null : label }))
  }

  function clearFilters() {
    setFilters(emptyFilters)
  }

  const signedIn = Boolean(me)
  const layout = !isLoaded || !sessionChecked ? 'checking' : signedIn ? 'signed-in' : 'signed-out'
  const activeFilters = [
    filters.query.trim() !== '',
    filters.section !== 'all',
    filters.keyword !== null,
    filters.view !== 'all',
  ].filter(Boolean).length

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-ink">
      <a
        href="#top"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-5 focus-visible:top-3 focus-visible:z-[60] focus-visible:rounded-lg focus-visible:bg-white focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-ink focus-visible:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3">
            <BrandMark className="size-10 shrink-0 sm:size-11" />
            <span className="whitespace-nowrap">
              <span className="block font-display text-base font-semibold leading-tight sm:text-lg" translate="no">Well7 Research Lab</span>
              <span className="hidden text-xs text-muted-foreground sm:block">Synthetic Data Weekly</span>
            </span>
          </a>

          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <a href="#report" onClick={selectLatest}>Latest brief</a>
            </Button>
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
              <a href="#archive">Archive</a>
            </Button>
            <Button variant="ghost" size="sm" className="hidden md:inline-flex" asChild>
              <a href="#library">My library</a>
            </Button>
            <Show when="signed-in">
              <span className="ml-1 flex items-center gap-2">
                {me?.email && (
                  <span className="hidden max-w-44 truncate text-xs text-muted-foreground lg:block">{me.email}</span>
                )}
                <UserButton />
              </span>
            </Show>
            <Show when="signed-out">
              <span className="ml-1 flex items-center gap-2">
                <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => clerk.openSignUp()}>Sign up</Button>
                <Button variant="ink" size="sm" onClick={() => clerk.openSignIn()}>Sign in</Button>
              </span>
            </Show>
          </nav>
        </div>
      </header>

      <main id="top">
        {layout === 'signed-out' && (
          <section className="mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
            <div className="grid items-center gap-12 grid-cols-[minmax(0,1fr)] lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
              <BlurFade direction="up" duration={0.55} className="min-w-0">
                <div>
                  <Badge variant="outline" className="border-mint/25 bg-[#e9f7f3] px-3 py-1.5 text-[#146c63]">
                    <ShieldCheck aria-hidden="true" />
                    Numbers checked against their sources
                  </Badge>
                  <h1 className="mt-6 max-w-2xl text-balance font-display text-[clamp(2.8rem,6vw,5.25rem)] font-medium leading-[0.99] tracking-[-0.045em] text-ink">
                    The week in privacy-first synthetic data.
                  </h1>
                  <p className="mt-7 max-w-xl text-lg leading-8 text-muted-foreground">
                    A weekly brief for the Well7 Research Lab team: tabular and time-series synthesis, formal privacy guarantees, and the evaluation work behind them — selected from the noise around generated data.
                  </p>
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <Button size="lg" variant="ink" onClick={() => clerk.openSignIn()}>
                      Sign in to your feed
                      <ArrowRight aria-hidden="true" />
                    </Button>
                    <Button size="lg" variant="outline" asChild>
                      <a href="#report" onClick={selectLatest}>Read the latest brief</a>
                    </Button>
                    {Boolean(selectedReport?.has_pdf) && (
                      <Button size="lg" variant="ghost" asChild>
                        <a href={`/api/reports/${selectedReport?.id}/pdf`}>
                          <ArrowDownToLine aria-hidden="true" />
                          Download PDF
                        </a>
                      </Button>
                    )}
                  </div>
                  <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="size-4" aria-hidden="true" />
                    New findings every Saturday
                  </p>
                </div>
              </BlurFade>

              <BlurFade direction="left" delay={0.12} duration={0.6} className="min-w-0">
                <SignalVisual itemCount={items.length} sourceCount={sourceCount} averageScore={averageScore} />
              </BlurFade>
            </div>

            <div className="mt-16 grid grid-cols-2 border-y border-border py-7 sm:grid-cols-4 sm:py-8">
              {[
                { label: 'Reports archived', value: reports.length, decimals: 0 },
                { label: 'Findings in this brief', value: items.length, decimals: 0 },
                { label: 'Sources represented', value: sourceCount, decimals: 0 },
                { label: 'Average relevance', value: averageScore, decimals: 1 },
              ].map((stat, index) => (
                <div key={stat.label} className={`px-4 py-4 sm:px-7 sm:py-0 ${index > 0 ? 'sm:border-l sm:border-border' : ''} ${index === 1 ? 'border-l border-border' : ''} ${index >= 2 ? 'border-t border-border sm:border-t-0' : ''}`}>
                  <NumberTicker value={stat.value} decimalPlaces={stat.decimals} className="font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl" />
                  <p className="mt-1.5 text-sm text-muted-foreground">{stat.label}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {layout === 'signed-out' && (
          <>
            <SignInTeaser onSignIn={() => clerk.openSignIn()} onSignUp={() => clerk.openSignUp()} />
            <LandingInfo />
          </>
        )}

        <section id="report" className="border-t border-border bg-white/55">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
            {archiveError && (
              <div className="mb-10 flex flex-col items-start gap-4 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-5 text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
                <div className="flex items-start gap-3">
                  <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                  <div><p className="font-semibold">The archive is unavailable</p><p className="mt-1 text-sm">{archiveError}</p></div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setArchiveRetry((value) => value + 1)}><RefreshCw aria-hidden="true" />Try again</Button>
              </div>
            )}

            {reportLoading && (
              <div role="status" aria-live="polite" aria-label="Loading report…" className="space-y-8">
                <div className="space-y-3"><Skeleton className="h-5 w-32" /><Skeleton className="h-12 w-full max-w-2xl" /><Skeleton className="h-5 w-52" /></div>
                <Skeleton className="h-40 w-full rounded-3xl" />
                <div className="space-y-5"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
              </div>
            )}

            {reportError && !reportLoading && (
              <div className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-6 text-destructive" role="alert">
                <CircleAlert className="size-6" aria-hidden="true" />
                <h2 className="mt-3 text-balance font-display text-2xl">This brief did not load</h2>
                <p className="mt-2 text-sm">{reportError}</p>
                <Button className="mt-5" variant="outline" size="sm" onClick={() => setReportRetry((value) => value + 1)}><RefreshCw aria-hidden="true" />Try again</Button>
              </div>
            )}

            {!reportLoading && !reportError && selectedReport && (
              <div className={signedIn ? 'lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-16' : undefined}>
                {signedIn && (
                  <FeedSidebar
                    reports={reports}
                    selectedId={selectedId}
                    onSelectWeek={setSelectedId}
                    view={filters.view}
                    viewCounts={viewCounts}
                    onView={setView}
                  />
                )}

                <div className="min-w-0">
                  <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
                    <div>
                      <p className="text-sm font-semibold text-primary">Current brief</p>
                      <h2 className="mt-3 max-w-3xl text-balance font-display text-4xl font-medium leading-tight tracking-[-0.03em] sm:text-5xl">
                        {briefTitle(selectedReport.subject)}
                      </h2>
                      <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="size-4" aria-hidden="true" />
                        Week ending {formatDate(selectedReport.week_end)}
                      </p>
                    </div>
                    {Boolean(selectedReport.has_pdf) && (
                      <Button variant="outline" asChild>
                        <a href={`/api/reports/${selectedReport?.id}/pdf`}><FileText aria-hidden="true" />Open the PDF</a>
                      </Button>
                    )}
                  </div>

                  <KeywordStrip counts={keywords} active={filters.keyword} onToggle={toggleKeyword} />

                  {selectedReport.trend && (
                    <Card className="mt-10 rounded-[24px] border-0 bg-[#eaf0f7] shadow-none">
                      <CardContent className="grid gap-5 p-6 sm:p-8 md:grid-cols-[190px_1fr] md:gap-10">
                        <div className="flex items-start gap-3 text-primary">
                          <BookOpen className="mt-1 size-5" aria-hidden="true" />
                          <div><h3 className="font-semibold text-ink">The editorial read</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">The pattern across this week’s selections</p></div>
                        </div>
                        <p className="max-w-4xl font-display text-xl leading-8 text-ink/90 sm:text-2xl sm:leading-9">{selectedReport.trend}</p>
                      </CardContent>
                    </Card>
                  )}

                  <div className="mt-14">
                    <div className="mb-7">
                      <h3 className="text-balance font-display text-3xl font-medium tracking-[-0.025em]">Inside this brief</h3>
                      <p className="mt-2 text-sm text-muted-foreground">Read the source, compare relevance and Well7 fit, follow the evidence.</p>
                    </div>

                    <FeedFilterBar
                      query={filters.query}
                      onQuery={setQuery}
                      section={filters.section}
                      onSection={setSection}
                      sectionCounts={totals}
                      activeFilters={activeFilters}
                      onClear={clearFilters}
                    />

                    {actionError && (
                      <p className="mt-6 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">{actionError}</p>
                    )}

                    <div className="mt-8">
                      {visibleItems.length > 0 ? (
                        <FeedList
                          items={visibleItems}
                          saved={savedById}
                          signedIn={signedIn}
                          active={filters.keyword}
                          onKeyword={toggleKeyword}
                          onToggle={togglePaper}
                        />
                      ) : (
                        <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-12 text-center">
                          <FileText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
                          <p className="mt-3 font-medium">Nothing matches these filters.</p>
                          <p className="mt-1 text-sm text-muted-foreground">Try another key word or section, or clear the filters.</p>
                          <Button className="mt-5" variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
                        </div>
                      )}
                    </div>
                  </div>

                  <NewsList items={visibleItems} active={filters.keyword} onKeyword={toggleKeyword} />
                </div>
              </div>
            )}

            {!archiveLoading && !archiveError && reports.length === 0 && (
              <div className="rounded-3xl border border-dashed border-border bg-white/70 px-6 py-20 text-center">
                <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="mt-4 text-balance font-display text-3xl">Your first brief starts with the pipeline.</h2>
                <p className="mx-auto mt-3 max-w-lg text-muted-foreground">Publish a completed weekly report to make it available here with its findings, scores, and PDF.</p>
              </div>
            )}
          </div>
        </section>

        <section id="library" className="border-t border-border bg-white/55">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
            <div className="mb-10 max-w-2xl">
              <p className="text-sm font-semibold text-primary">My library</p>
              <h2 className="mt-3 text-balance font-display text-4xl font-medium tracking-[-0.03em]">Papers you saved.</h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Read later, important marks and notes across every week. Only you can see them.
              </p>
            </div>

            {signedIn ? (
              <Library
                entries={library}
                onToggle={togglePaper}
                onNote={saveNote}
                loading={libraryLoading}
                error={libraryError}
              />
            ) : (
              <div className="rounded-3xl border border-dashed border-border bg-white/70 px-6 py-14 text-center">
                <p className="font-display text-2xl">Sign in to build your library.</p>
                <p className="mx-auto mt-2 max-w-md text-muted-foreground">
                  Your Read later, Important marks and notes stay private to your account.
                </p>
                <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                  <Button variant="ink" onClick={() => clerk.openSignIn()}>Sign in</Button>
                  <Button variant="outline" onClick={() => clerk.openSignUp()}>Create an account</Button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section id="archive" className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[0.65fr_1.35fr] lg:gap-20">
            <div>
              <p className="text-sm font-semibold text-primary">Report archive</p>
              <h2 className="mt-3 text-balance font-display text-4xl font-medium tracking-[-0.03em]">Every week, kept in context.</h2>
              <p className="mt-5 max-w-md leading-7 text-muted-foreground">Return to an earlier brief without losing its rankings, source links, or editorial perspective.</p>
              {me?.isAdmin && (
                <Button className="mt-6" variant="ink" onClick={runPipeline} disabled={running}>
                  <RefreshCw aria-hidden="true" />
                  {running ? 'Running the pipeline…' : 'Run the pipeline now'}
                </Button>
              )}
            </div>

            <div className="overflow-hidden rounded-[24px] border border-border bg-white shadow-[0_20px_60px_-42px_rgba(16,42,67,0.4)]">
              {archiveLoading && <div className="space-y-5 p-6"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>}
              {!archiveLoading && reports.map((report, index) => {
                const active = report.id === selectedId
                return (
                  <div key={report.id}>
                    {index > 0 && <Separator />}
                    <button
                      type="button"
                      onClick={() => openReport(report.id)}
                      className="group flex w-full items-center gap-4 px-5 py-6 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7"
                      aria-pressed={active}
                    >
                      <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${active ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}>
                        {active ? <Check className="size-5" aria-hidden="true" /> : <CalendarDays className="size-5" aria-hidden="true" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words font-display text-lg font-medium leading-snug text-ink">{briefTitle(report.subject)}</span>
                        <span className="mt-1.5 block text-sm text-muted-foreground">Week ending {formatDate(report.week_end, 'short')}</span>
                      </span>
                      <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-white/55">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-6 shrink-0" />
            <span className="font-semibold text-ink" translate="no">Well7 Research Lab</span>
          </div>
          <p>Well7 Research Lab · Collected and ranked every Saturday.</p>
        </div>
      </footer>
    </div>
  )
}
