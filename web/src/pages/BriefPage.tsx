import { useEffect, useState } from 'react'
import { CalendarDays, CircleAlert, FileText, RefreshCw } from 'lucide-react'

import { FeedFilterBar, FeedList, KeywordStrip } from '@/components/feed-panel'
import { NewsList } from '@/components/news-list'
import { WeekShape } from '@/components/week-shape'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { type LibraryBundle } from '@/lib/api'
import { chipScopes, filterItems, keywordCounts, sectionCounts, type FeedFilters } from '@/lib/feed'
import { briefTitle, formatDate } from '@/lib/report'
import { Link, navigate } from '@/lib/router'
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

export function BriefPage({ week, signedIn, library, follows, onFollow }: BriefPageProps) {
  const { reports, loading: reportsLoading, error: reportsError, retry: retryReports } = useReports()
  const { report, items, loading, error, notFound, retry: retryReport } = useReport(week ?? null)
  const [filters, setFilters] = useState<FeedFilters>(emptyFilters)

  useEffect(() => {
    if (!week && !reportsLoading && reports.length > 0) {
      navigate(`/brief/${reports[0].id}`, { replace: true })
    }
  }, [week, reportsLoading, reports])

  const savedById = library.savedById
  const visibleItems = filterItems(items, filters, savedById)
  const scopes = chipScopes(items, filters, savedById)
  const keywords = keywordCounts(scopes.keyword)
  const totals = sectionCounts(scopes.section)
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
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
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
          <Skeleton className="h-12 w-full max-w-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <div className="space-y-5"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
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

      {!loading && !reportsLoading && !notFound && !error && reports.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-12 text-center">
          <p className="text-balance font-display text-2xl text-ink">Your first brief starts with the pipeline.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Nothing has been published yet. Once a weekly report runs, the latest brief lands here.
          </p>
          <Button className="mt-5" variant="outline" size="sm" asChild>
            <Link to="/studio">Open Live Studio</Link>
          </Button>
        </div>
      )}

      {!loading && !reportsLoading && report && (
        <div className="min-w-0">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <h1 className="max-w-3xl text-balance font-display text-4xl font-medium leading-tight tracking-[-0.03em] text-ink sm:text-5xl">
                {briefTitle(report.subject)}
              </h1>
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="size-4" aria-hidden="true" />
                Week ending {formatDate(report.week_end)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button variant="outline" size="sm" asChild>
                <Link to="/studio">Check a topic live</Link>
              </Button>
              {Boolean(report.has_pdf) && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noopener">
                    <FileText aria-hidden="true" />
                    Open PDF
                  </a>
                </Button>
              )}
            </div>
          </div>

          {report.trend && (
            <BlurFade inView duration={0.35}>
              <div className="mt-10 grid gap-4 border-y border-border/80 py-7 md:grid-cols-[180px_1fr] md:gap-10">
                <div>
                  <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    The editorial read
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Pattern across this week
                  </p>
                </div>
                <p className="max-w-[68ch] font-display text-xl leading-8 text-ink/90 sm:text-2xl sm:leading-9">
                  {report.trend}
                </p>
              </div>
            </BlurFade>
          )}

          <div className="mt-8">
            <BlurFade inView duration={0.35}>
              <WeekShape items={items} />
            </BlurFade>
          </div>

          <KeywordStrip counts={keywords} active={filters.keyword} onToggle={toggleKeyword} follows={follows} onFollow={onFollow} />

          <div className="mt-14">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-balance font-display text-3xl font-medium tracking-[-0.025em] text-ink">
                  Inside this brief
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Read the source, compare relevance and Well7 fit, follow the evidence.
                </p>
              </div>
            </div>

            <FeedFilterBar
              query={filters.query}
              onQuery={(query) => setFilters((current) => ({ ...current, query }))}
              section={filters.section}
              onSection={(section) => setFilters((current) => ({ ...current, section }))}
              sectionCounts={totals}
              activeFilters={activeFilters}
              onClear={() => setFilters(emptyFilters)}
            />

            {library.error && (
              <p className="mt-6 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">{library.error}</p>
            )}

            <div className="mt-7">
              {visibleItems.length > 0 ? (
                <FeedList
                  items={visibleItems}
                  saved={savedById}
                  signedIn={signedIn}
                  active={filters.keyword}
                  onKeyword={toggleKeyword}
                  onToggle={library.togglePaper}
                  follows={follows}
                  onFollow={onFollow}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-12 text-center">
                  <FileText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 font-medium">Nothing matches these filters.</p>
                  <p className="mt-1 text-sm text-muted-foreground">Try another key word or section, or clear the filters.</p>
                  <Button className="mt-5" variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>Clear filters</Button>
                </div>
              )}
            </div>
          </div>

          <NewsList items={visibleItems} active={filters.keyword} onKeyword={toggleKeyword} follows={follows} onFollow={onFollow} />
        </div>
      )}
    </section>
  )
}
