import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, CalendarDays, CircleAlert, FileText, RefreshCw } from 'lucide-react'

import { EditorialTakeaway } from '@/components/editorial-takeaway'
import { FeedFilterBar, FeedList, KeywordStrip, type BriefSortOrder } from '@/components/feed-panel'
import { HorizonRibbon } from '@/components/horizon-ribbon'
import { Link } from '@/components/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type LibraryBundle } from '@/lib/api'
import { chipScopes, filterItems, keywordCounts, sectionCounts, type FeedFilters } from '@/lib/feed'
import { briefTitle, formatDate, parseUtcTimestamp, type Report, type ReportItem } from '@/lib/report'
import { estimateBriefMinutes, useRitualProgress } from '@/lib/ritual'
import { navigate, useLocationSearch } from '@/lib/router'
import { useReport, useReports } from '@/lib/use-report'
import type { TopicFollow, TopicKind } from '@/lib/topics'

const emptyFilters: FeedFilters = { query: '', section: 'all', keyword: null, view: 'all' }

interface BriefPageProps {
  /** The report id from /brief/<week>; undefined means "redirect to the latest". */
  week?: string
  signedIn: boolean
  library: LibraryBundle
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, value: string, next: boolean) => void
}

interface BriefContentProps {
  report: Report
  items: ReportItem[]
  signedIn: boolean
  library: LibraryBundle
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, value: string, next: boolean) => void
  initialItemId?: string | null
}

function BriefContent({
  report,
  items,
  signedIn,
  library,
  follows,
  onFollow,
  initialItemId,
}: BriefContentProps) {
  const [filters, setFilters] = useState<FeedFilters>(emptyFilters)
  const [sortOrder, setSortOrder] = useState<BriefSortOrder>('ranked')
  const { readCount, totalCount, percent, markRead } = useRitualProgress(report.id, items)
  const briefMinutes = estimateBriefMinutes(items)

  useEffect(() => {
    if (!initialItemId) return
    const match = items.find((item) => item.id === initialItemId)
    if (!match) return
    markRead(initialItemId)
    const rafId = window.requestAnimationFrame(() => {
      const element = document.getElementById(`brief-item-${initialItemId}`)
      if (!element) return
      const reducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' })
    })
    return () => window.cancelAnimationFrame(rafId)
  }, [initialItemId, items, markRead])

  const savedById = library.savedById
  const visibleItems = useMemo(() => {
    const filtered = filterItems(items, filters, savedById)
    if (sortOrder === 'newest') {
      return [...filtered].sort((a, b) => parseUtcTimestamp(b.published) - parseUtcTimestamp(a.published))
    }
    return filtered
  }, [items, filters, savedById, sortOrder])

  const scopes = useMemo(() => chipScopes(items, filters, savedById), [items, filters, savedById])
  const keywords = useMemo(() => keywordCounts(scopes.keyword), [scopes])
  const totals = useMemo(() => sectionCounts(scopes.section), [scopes])
  const activeFilters = [
    filters.query.trim() !== '',
    filters.section !== 'all',
    filters.keyword !== null,
    filters.view !== 'all',
  ].filter(Boolean).length

  function toggleKeyword(label: string) {
    setFilters((current) => ({ ...current, keyword: current.keyword === label ? null : label }))
  }

  return (
    <div className="min-w-0">
      <div className="mb-4">
        <Link
          to="/archive"
          className="inline-flex items-center gap-1.5 rounded-sm text-xs font-semibold text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          All weekly briefs
        </Link>
      </div>

      {/* Compact Horizon Sunrise Masthead */}
      <section className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-[22px] bg-[#0e3e40] p-6 text-[#faf4ec] shadow-[0_18px_44px_rgba(14,62,64,0.14)] sm:p-8 lg:flex-row lg:items-end">
        <HorizonRibbon variant="compact" />

        <div className="relative z-10">
          <h1 className="max-w-3xl text-balance font-display text-3xl font-medium leading-tight tracking-[-0.02em] text-[#faf4ec] sm:text-4xl">
            {briefTitle(report.subject)}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#faf4ec]/85">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden="true" />
              Week ending {formatDate(report.week_end)}
            </span>
            <span className="font-mono text-xs text-[#f0c281] tabular-nums">
              {briefMinutes} min read, {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <Link
              to="/studio"
              className="inline-flex min-h-9 items-center justify-center rounded-full bg-[#faf4ec] px-4 py-1.5 text-xs font-bold text-[#0e3e40] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
            >
              Search a topic live
            </Link>
            {Boolean(report.has_pdf) && (
              <a
                href={`/api/reports/${report.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-[#faf4ec]/35 bg-[#faf4ec]/10 px-4 py-1.5 text-xs font-semibold text-[#faf4ec] transition-colors hover:bg-[#faf4ec]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
              >
                <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                Open PDF
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>

        {totalCount > 0 && (
          <div className="relative z-10 w-full rounded-2xl border border-[#faf4ec]/22 bg-[#fffdf9]/10 p-4 backdrop-blur-md lg:max-w-[290px]">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-[#faf4ec]/90">
              <span>Calm check-in</span>
              <span className="font-mono tabular-nums">
                {readCount} of {totalCount} read
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Weekly brief reading progress"
              aria-valuenow={readCount}
              aria-valuemin={0}
              aria-valuemax={totalCount}
              className="h-2 overflow-hidden rounded-full bg-white/20"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#f0c281] to-[#7dd3c7] transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {report.trend && (
        <EditorialTakeaway text={report.trend} label="Weekly takeaway" />
      )}

      <KeywordStrip counts={keywords} active={filters.keyword} onToggle={toggleKeyword} follows={follows} onFollow={onFollow} />

      <div className="mt-8">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-balance font-display text-2xl font-medium tracking-[-0.02em] text-primary">
              Inside this brief
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Filter by topic or section, switch between ranked and newest order, or expand any item to read the full summary.
            </p>
          </div>
          <p role="status" className="font-mono text-xs text-muted-foreground tabular-nums">
            Showing {visibleItems.length} of {items.length}
          </p>
        </div>

        <FeedFilterBar
          query={filters.query}
          onQuery={(query) => setFilters((current) => ({ ...current, query }))}
          section={filters.section}
          onSection={(section) => setFilters((current) => ({ ...current, section }))}
          sectionCounts={totals}
          activeFilters={activeFilters}
          onClear={() => setFilters(emptyFilters)}
          sortOrder={sortOrder}
          onSortOrder={setSortOrder}
        />

        {library.error && (
          <p className="mt-6 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
            {library.error}
          </p>
        )}

        <div className="mt-6">
          {visibleItems.length > 0 ? (
            <FeedList
              items={visibleItems}
              weekEnd={report.week_end}
              headingLevel="h3"
              saved={savedById}
              signedIn={signedIn}
              active={filters.keyword}
              onKeyword={toggleKeyword}
              onToggle={library.togglePaper}
              follows={follows}
              onFollow={onFollow}
              initialExpandedId={initialItemId}
              onInspect={markRead}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
              <FileText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 font-medium text-ink">Nothing matches these filters.</p>
              <p className="mt-1 text-sm text-muted-foreground">Try another keyword or section, or clear the filters.</p>
              <Button className="mt-5" variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>
                Clear filters
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function BriefPage({ week, signedIn, library, follows, onFollow }: BriefPageProps) {
  const { reports, loading: reportsLoading, error: reportsError, retry: retryReports } = useReports()
  const resolvedWeek = week ?? reports[0]?.id ?? null
  const { report, items, loading, error, notFound, retry: retryReport } = useReport(resolvedWeek)
  const locationSearch = useLocationSearch()
  const initialItemId = useMemo(
    () => new URLSearchParams(locationSearch).get('item'),
    [locationSearch],
  )

  useEffect(() => {
    if (!week && !reportsLoading && reports.length > 0) {
      navigate(`/brief/${reports[0].id}${locationSearch}`, { replace: true })
    }
  }, [week, reportsLoading, reports, locationSearch])

  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-8 sm:px-8 sm:pt-10">
      {reportsError && (
        <div className="mb-8 flex flex-col items-start gap-4 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-5 text-destructive sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span className="flex items-start gap-3">
            <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            {reportsError}
          </span>
          <Button variant="outline" size="sm" onClick={retryReports}><RefreshCw aria-hidden="true" />Try again</Button>
        </div>
      )}

      {(loading || reportsLoading) && (
        <div role="status" aria-live="polite" aria-label="Loading the brief…" className="space-y-8">
          <Skeleton className="h-36 w-full rounded-[22px]" />
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="space-y-5">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      )}

      {!loading && !reportsLoading && notFound && (
        <div className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-6 text-destructive" role="alert">
          <CircleAlert className="size-6" aria-hidden="true" />
          <h1 className="mt-3 text-balance font-display text-3xl">This brief does not exist.</h1>
          <p className="mt-2 text-sm">The week link is unknown — every published week is in the archive.</p>
          <Button className="mt-5" variant="outline" size="sm" asChild>
            <Link to="/archive">Open the archive</Link>
          </Button>
        </div>
      )}

      {!loading && !reportsLoading && error && !notFound && (
        <div className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-6 text-destructive" role="alert">
          <CircleAlert className="size-6" aria-hidden="true" />
          <h1 className="mt-3 text-balance font-display text-3xl">This brief did not load</h1>
          <p className="mt-2 text-sm">{error}</p>
          <Button className="mt-5" variant="outline" size="sm" onClick={retryReport}><RefreshCw aria-hidden="true" />Try again</Button>
        </div>
      )}

      {!loading && !reportsLoading && !notFound && !error && !reportsError && !report && reports.length === 0 && (
        <div className="rounded-2xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
          <h1 className="text-balance font-display text-3xl font-medium text-primary">No weekly briefs published yet.</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Once a weekly report runs, the latest brief lands here. You can search live sources anytime.
          </p>
          <Button className="mt-5" variant="outline" size="sm" asChild>
            <Link to="/studio">Search live</Link>
          </Button>
        </div>
      )}

      {!loading && !reportsLoading && report && (
        <BriefContent
          key={report.id}
          report={report}
          items={items}
          signedIn={signedIn}
          library={library}
          follows={follows}
          onFollow={onFollow}
          initialItemId={initialItemId}
        />
      )}
    </section>
  )
}
