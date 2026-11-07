import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CircleAlert, RefreshCw, Sparkles } from 'lucide-react'

import { FeedFilterBar, FeedList, FeedSidebar } from '@/components/feed-panel'
import { TopicPanel, type TopicCount } from '@/components/topic-panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchArchiveCounts, type LibraryBundle, type ArchiveCounts } from '@/lib/api'
import { filterItems, sectionCounts, type FeedFilters, type FeedView } from '@/lib/feed'
import { briefTitle, formatDate } from '@/lib/report'
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
 * `/feed` (spec, signed in): the current brief filtered to the topics and
 * sources I follow, with the **My topics** manager. With nothing followed the
 * whole brief shows plus a pick-topics prompt — never an empty page.
 */
export function FeedPage({ signedIn, follows, onFollow, onSignIn, library }: FeedPageProps) {
  const { reports, loading: reportsLoading, error: reportsError, retry: retryReports } = useReports()
  // The week shown: the reader's own pick, else the latest report. Derived, so
  // a report landing after the handshake needs no effect to take effect.
  const [pickedWeek, setPickedWeek] = useState<string | null>(null)
  const weekId = pickedWeek ?? reports[0]?.id ?? null

  const { report, items, loading, error, notFound, retry: retryReport } = useReport(weekId)
  const [filters, setFilters] = useState<FeedFilters>(emptyFilters)

  const savedById = library.savedById
  const feedItems = useMemo(
    () => {
      const filtered = filterItems(items, filters, savedById)
      // Spec: with nothing followed the whole brief shows, next to the
      // pick-topics prompt — never an empty page (matchesFollows of an empty
      // list would exclude everything).
      if (follows.length === 0) return filtered
      return filtered.filter((item) => matchesFollows(item, follows))
    },
    [items, filters, savedById, follows],
  )
  const totals = sectionCounts(items)
  const viewCounts = useMemo<Record<FeedView, number>>(() => ({
    all: items.length,
    read_later: items.filter((item) => savedById.get(item.id)?.read_later === 1).length,
    important: items.filter((item) => savedById.get(item.id)?.important === 1).length,
  }), [items, savedById])
  const activeFilters = [
    filters.query.trim() !== '',
    filters.section !== 'all',
    filters.keyword !== null,
    filters.view !== 'all',
  ].filter(Boolean).length

  // Spec: My topics lists every topic and source seen in the ARCHIVE, not just
  // the picked week — so a follow made in an earlier week is still visible and
  // unfollowable. Falls back to the current week's counts if the endpoint is
  // unavailable; never blocks the panel.
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
      <section className="mx-auto max-w-3xl px-5 py-20 text-center sm:px-8">
        <Sparkles className="mx-auto size-6 text-primary" aria-hidden="true" />
        <h1 className="mt-4 text-balance font-display text-4xl font-medium tracking-[-0.03em] text-ink">Your feed is yours only.</h1>
        <p className="mx-auto mt-3 max-w-md text-muted-foreground">
          Sign in to pick the topics and sources you care about — this brief never collects anything about you.
        </p>
        <Button className="mt-8" variant="ink" size="lg" onClick={onSignIn}>Sign in</Button>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className={report ? 'lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-16' : undefined}>
        <FeedSidebar
          reports={reports}
          selectedId={weekId}
          onSelectWeek={setPickedWeek}
          view={filters.view}
          viewCounts={viewCounts}
          onView={(view) => setFilters((current) => ({ ...current, view }))}
        />

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
            <div role="status" aria-live="polite" className="space-y-8">
              <Skeleton className="h-40 w-full rounded-3xl" />
              <div className="space-y-5"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
            </div>
          )}

          {!reportsLoading && !reportsError && reports.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-12 text-center">
              <p className="font-medium">The pipeline has not published a brief yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Once a report runs, your feed shows it here. In the meantime the archive stays empty.
              </p>
            </div>
          )}

          {notFound && !loading && (
            <p className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-5 text-sm text-destructive" role="alert">
              This week no longer exists.
              <Button className="ml-3" variant="outline" size="sm" onClick={retryReports}>Reload the weeks</Button>
            </p>
          )}

          {error && !loading && !notFound && (
            <div className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-6 text-destructive" role="alert">
              <CircleAlert className="size-5" aria-hidden="true" />
              <p className="mt-2 text-sm">{error}</p>
              <Button className="mt-4" variant="outline" size="sm" onClick={retryReport}><RefreshCw aria-hidden="true" />Try again</Button>
            </div>
          )}

          {report && (
            <>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-semibold text-primary">Your feed</p>
                  <h1 className="mt-2 max-w-3xl text-balance font-display text-3xl font-medium leading-tight tracking-[-0.03em] sm:text-4xl">
                    {briefTitle(report.subject)}
                  </h1>
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="size-4" aria-hidden="true" />
                    Week ending {formatDate(report.week_end)}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {follows.length === 0 ? 'Showing everything until you pick topics.' : `Filtered to ${follows.length} followed ${follows.length === 1 ? 'item' : 'items'}.`}
                </p>
              </div>

              {follows.length === 0 && (
                <div className="mt-6 rounded-2xl border border-primary/25 bg-[#eef7f5] p-4 text-sm text-ink/80">
                  <Sparkles className="mr-2 inline size-4 text-primary" aria-hidden="true" />
                  Star a few topics below (or on any chip) and your feed narrows to them.
                </div>
              )}

              <div className="mt-8">
                <TopicPanel follows={follows} counts={counts} onToggle={onFollow} />
              </div>

              <div className="mt-12">
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

                <div className="mt-8">
                  {feedItems.length > 0 ? (
                    <FeedList
                      items={feedItems}
                      saved={savedById}
                      signedIn
                      active={null}
                      onKeyword={() => undefined}
                      onToggle={library.togglePaper}
                      follows={follows}
                      onFollow={onFollow}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-white/60 px-6 py-12 text-center">
                      <p className="mt-3 font-medium">
                        {follows.length > 0 ? 'Nothing followed matches these filters this week.' : 'Nothing matches these filters.'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">Try a different week or section, star more topics, or clear the filters.</p>
                      <Button className="mt-5" variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>Clear filters</Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
