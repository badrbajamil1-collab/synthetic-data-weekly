import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CircleAlert, RefreshCw, X } from 'lucide-react'

import { FeedFilterBar, FeedList, FeedSidebar } from '@/components/feed-panel'
import { TopicPanel, type TopicCount } from '@/components/topic-panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchArchiveCounts, type LibraryBundle, type ArchiveCounts } from '@/lib/api'
import { chipScopes, filterItems, sectionCounts, type FeedFilters, type FeedView } from '@/lib/feed'
import { briefTitle, formatDate, sourceLabel } from '@/lib/report'
import { useReport, useReports } from '@/lib/use-report'
import { matchesFollows, sourceCounts, topicCounts, type TopicFollow, type TopicKind } from '@/lib/topics'

const emptyFilters: FeedFilters = { query: '', section: 'all', keyword: null, view: 'all' }

interface FeedPageProps {
  signedIn: boolean
  follows: TopicFollow[]
  onFollow: (kind: TopicKind, value: string, next: boolean) => void
  onSignIn: () => void
  library: LibraryBundle
}

/**
 * `/feed` (signed in): the current brief filtered to followed topics and sources,
 * plus the anchored Topics & sources manager.
 */
export function FeedPage({ signedIn, follows, onFollow, onSignIn, library }: FeedPageProps) {
  const { reports, loading: reportsLoading, error: reportsError, retry: retryReports } = useReports()
  const [pickedWeek, setPickedWeek] = useState<string | null>(null)
  const weekId = pickedWeek ?? reports[0]?.id ?? null

  const { report, items, loading, error, notFound, retry: retryReport } = useReport(weekId)
  const [filters, setFilters] = useState<FeedFilters>(emptyFilters)

  const savedById = library.savedById
  const followedItems = useMemo(() => {
    if (follows.length === 0) return items
    return items.filter((item) => matchesFollows(item, follows))
  }, [items, follows])

  const feedItems = useMemo(
    () => filterItems(followedItems, filters, savedById),
    [followedItems, filters, savedById],
  )
  const scopes = useMemo(
    () => chipScopes(followedItems, filters, savedById),
    [followedItems, filters, savedById],
  )
  const totals = useMemo(() => sectionCounts(scopes.section), [scopes])
  const viewCounts = useMemo<Record<FeedView, number>>(() => ({
    all: scopes.view.length,
    read_later: scopes.view.filter((item) => savedById.get(item.id)?.read_later === 1).length,
    important: scopes.view.filter((item) => savedById.get(item.id)?.important === 1).length,
  }), [scopes, savedById])

  const activeFilters = [
    filters.query.trim() !== '',
    filters.section !== 'all',
    filters.keyword !== null,
    filters.view !== 'all',
  ].filter(Boolean).length

  function handleSelectWeek(id: string) {
    setPickedWeek(id)
    setFilters(emptyFilters)
  }

  function toggleKeyword(label: string) {
    setFilters((current) => ({ ...current, keyword: current.keyword === label ? null : label }))
  }

  const [archiveCounts, setArchiveCounts] = useState<ArchiveCounts | null>(null)
  useEffect(() => {
    let active = true
    void fetchArchiveCounts().then((counts) => {
      if (active) setArchiveCounts(counts)
    })
    return () => {
      active = false
    }
  }, [])

  const counts = useMemo<TopicCount[]>(() => {
    if (archiveCounts) {
      return [
        ...archiveCounts.topics.map((row) => ({ kind: 'topic' as TopicKind, label: row.label, count: row.count })),
        ...archiveCounts.sources.map((row) => ({ kind: 'source' as TopicKind, label: row.label, count: row.count })),
      ]
    }
    return [
      ...topicCounts(items).map((row) => ({ kind: 'topic' as TopicKind, label: row.label, count: row.count })),
      ...sourceCounts(items).map((row) => ({ kind: 'source' as TopicKind, label: row.label, count: row.count })),
    ]
  }, [archiveCounts, items])

  if (!signedIn) {
    return (
      <section className="mx-auto max-w-3xl px-5 pb-20 pt-12 sm:px-8 sm:pt-16">
        <div className="rounded-3xl border border-dashed border-input bg-[#fffdf9] px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)] sm:px-10">
          <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.02em] text-primary sm:text-4xl">
            Follow the topics you care about.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-muted-foreground">
            Sign in to star topics and sources for a personalized weekly view — your follows stay private to your account.
          </p>
          <Button className="mt-8" variant="default" size="lg" onClick={onSignIn}>
            Sign in
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_270px] lg:gap-12">
        <div className="min-w-0">
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
            <div role="status" aria-live="polite" aria-label="Loading your feed…" className="space-y-8">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <div className="space-y-5">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            </div>
          )}

          {!reportsLoading && !reportsError && reports.length === 0 && (
            <div className="rounded-2xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
              <h1 className="font-display text-3xl font-medium text-primary">Your feed is ready.</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                No weekly brief has been published yet. Once a report runs, your feed will appear here.
              </p>
            </div>
          )}

          {notFound && !loading && (
            <div className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-6 text-destructive" role="alert">
              <h1 className="font-display text-2xl font-medium">This week no longer exists.</h1>
              <Button className="mt-4" variant="outline" size="sm" onClick={retryReports}>Reload the weeks</Button>
            </div>
          )}

          {error && !loading && !notFound && (
            <div className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-6 text-destructive" role="alert">
              <CircleAlert className="size-5" aria-hidden="true" />
              <h1 className="mt-2 font-display text-2xl font-medium">Could not load this week</h1>
              <p className="mt-1 text-sm">{error}</p>
              <Button className="mt-4" variant="outline" size="sm" onClick={retryReport}><RefreshCw aria-hidden="true" />Try again</Button>
            </div>
          )}

          {report && (
            <>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <h1 className="max-w-3xl text-balance font-display text-3xl font-medium leading-tight tracking-[-0.02em] text-primary sm:text-4xl">
                    {briefTitle(report.subject)}
                  </h1>
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Your feed · Week ending {formatDate(report.week_end)}
                  </p>
                </div>
                <p role="status" className="text-sm text-muted-foreground sm:text-right">
                  {activeFilters > 0
                    ? `Showing ${feedItems.length} of ${followedItems.length} ${followedItems.length === 1 ? 'item' : 'items'} after filters.`
                    : follows.length === 0
                      ? `Showing all ${items.length} ${items.length === 1 ? 'item' : 'items'} until you follow a topic.`
                      : `${followedItems.length} of ${items.length} ${items.length === 1 ? 'item matches' : 'items match'} your ${follows.length} followed ${follows.length === 1 ? 'topic' : 'topics'}.`}
                </p>
              </div>

              {follows.length === 0 ? (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e5bc84] bg-[#fdf3e2]/70 px-4 py-3.5 text-sm text-ink">
                  <span>Star any topic or source to narrow your feed automatically each week.</span>
                  <a
                    href="#manage-topics"
                    className="rounded-sm font-bold text-[#b46319] underline-offset-4 hover:text-[#965011] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Choose topics below
                  </a>
                </div>
              ) : (
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-muted-foreground">Following</span>
                  {follows.map((follow) => {
                    const display = follow.kind === 'source' ? sourceLabel(follow.value) : follow.value
                    return (
                      <button
                        key={`${follow.kind}:${follow.value}`}
                        type="button"
                        aria-label={`Stop following ${display}`}
                        onClick={() => onFollow(follow.kind, follow.value, false)}
                        className="touch-target inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1 text-xs font-semibold text-[#faf4ec] transition-colors hover:bg-[#092b2d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span>{follow.kind === 'source' ? `${display} (source)` : display}</span>
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    )
                  })}
                </div>
              )}

              <div className="mt-8">
                <h2 className="sr-only">Matching papers and tools</h2>
                <FeedFilterBar
                  query={filters.query}
                  onQuery={(query) => setFilters((current) => ({ ...current, query }))}
                  section={filters.section}
                  onSection={(section) => setFilters((current) => ({ ...current, section }))}
                  sectionCounts={totals}
                  activeFilters={activeFilters}
                  onClear={() => setFilters(emptyFilters)}
                />

                {filters.keyword && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>Filtered by topic: <strong className="font-semibold text-ink">{filters.keyword}</strong></span>
                    <button
                      type="button"
                      onClick={() => setFilters((current) => ({ ...current, keyword: null }))}
                      className="cursor-pointer rounded-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Clear topic
                    </button>
                  </div>
                )}

                {library.error && (
                  <p className="mt-6 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
                    {library.error}
                  </p>
                )}

                <div className="mt-6">
                  {feedItems.length > 0 ? (
                    <FeedList
                      items={feedItems}
                      weekEnd={report.week_end}
                      headingLevel="h3"
                      saved={savedById}
                      signedIn
                      active={filters.keyword}
                      onKeyword={toggleKeyword}
                      onToggle={library.togglePaper}
                      follows={follows}
                      onFollow={onFollow}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
                      <p className="font-medium text-ink">
                        {follows.length > 0 ? 'Nothing followed matches these filters this week.' : 'Nothing matches these filters.'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Try a different week or section, follow more topics below, or clear the filters.
                      </p>
                      {activeFilters > 0 && (
                        <Button className="mt-5" variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>
                          Clear filters
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-12">
                <TopicPanel id="manage-topics" follows={follows} counts={counts} onToggle={onFollow} />
              </div>
            </>
          )}
        </div>

        <FeedSidebar
          reports={reports}
          selectedId={weekId}
          onSelectWeek={handleSelectWeek}
          view={filters.view}
          viewCounts={viewCounts}
          onView={(view) => setFilters((current) => ({ ...current, view }))}
        />
      </div>
    </section>
  )
}
