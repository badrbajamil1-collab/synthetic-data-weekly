import { useId, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowUpRight, CalendarDays, CircleAlert, RefreshCw, Search } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/react'

import { Link } from '@/components/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { navigate } from '@/lib/router'
import { briefTitle, formatDate, sourceLabel } from '@/lib/report'
import { useReport, useReports } from '@/lib/use-report'

export function LandingPage() {
  const clerk = useClerk()
  const { isSignedIn } = useAuth()
  const { reports, loading: reportsLoading, error: reportsError, retry: retryReports } = useReports()
  const latest = reports[0] ?? null
  const {
    report: latestDetail,
    items,
    loading: itemsLoading,
    error: itemsError,
    retry: retryItem,
  } = useReport(latest?.id ?? null)

  const archiveDown = Boolean(reportsError) || (reports.length > 0 && Boolean(itemsError))
  const highlightsLoading = reportsLoading || (Boolean(latest) && itemsLoading)
  const hasPdf = Boolean(latestDetail?.has_pdf ?? latest?.has_pdf)
  const [quickQuery, setQuickQuery] = useState('')
  const searchInputId = useId()
  const searchInputRef = useRef<HTMLInputElement>(null)

  function handleSearchSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = quickQuery.trim()
    if (!trimmed) {
      searchInputRef.current?.focus()
      return
    }
    navigate(`/studio?q=${encodeURIComponent(trimmed)}&run=1`)
  }

  const previewItems = [...items]
    .sort((a, b) => {
      const rankOf = (section: string) => (section === 'top' || section === 'top_picks' ? 0 : section === 'tool' || section === 'tools' ? 1 : 2)
      return rankOf(a.section) - rankOf(b.section) || b.score - a.score || a.position - b.position
    })
    .slice(0, 3)

  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 sm:pt-12">
        {archiveDown && (
          <div className="mb-8 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>{reportsError ?? itemsError ?? 'The archive is unavailable.'}</span>
            <Button
              className="ml-auto"
              variant="outline"
              size="sm"
              onClick={() => (reportsError ? retryReports() : retryItem())}
            >
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          </div>
        )}

        {/* Editorial masthead: left-aligned headline + live search alongside latest edition card */}
        <section className="grid gap-8 pb-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)] lg:items-end lg:gap-12 lg:pb-12">
          <div>
            <h1 className="max-w-[18ch] text-balance font-display text-4xl font-medium leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl lg:text-[3.5rem]">
              Synthetic data research, curated and searchable.
            </h1>

            <p className="mt-4 max-w-[60ch] text-base leading-7 text-muted-foreground sm:text-lg">
              18 sources across arXiv, GitHub, research blogs, Hacker News, and news — ranked every Saturday for privacy-first tabular and time-series work, or searched live on demand.
            </p>

            <search className="mt-6 max-w-xl">
              <form
                onSubmit={handleSearchSubmit}
                className="flex flex-col gap-2 rounded-2xl border border-input bg-white p-1.5 shadow-2xs transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25 sm:flex-row"
              >
                <div className="relative flex-1">
                  <label htmlFor={searchInputId} className="sr-only">
                    Search synthetic data topics live
                  </label>
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    id={searchInputId}
                    name="q"
                    type="search"
                    value={quickQuery}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="search"
                    onChange={(event) => setQuickQuery(event.target.value)}
                    placeholder="Search a topic live (e.g. tabular privacy, clinical EHR)…"
                    className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none"
                  />
                </div>
                <Button type="submit" variant="ink" className="h-11 rounded-xl px-5">
                  Search live
                </Button>
              </form>
            </search>
          </div>

          {/* Grounded real-data edition card */}
          <div className="rounded-2xl border border-border bg-white p-5 shadow-2xs sm:p-6">
            {reportsLoading ? (
              <div role="status" aria-label="Loading latest edition" className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-7 w-56" />
                <Skeleton className="h-4 w-44" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-10 w-36 rounded-full" />
                  <Skeleton className="h-10 w-28 rounded-full" />
                </div>
              </div>
            ) : latest ? (
              <>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">Latest edition</span>
                  <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    {formatDate(latest.week_end, 'short')}
                  </span>
                </div>

                <h2 className="mt-2 font-display text-xl font-medium leading-snug tracking-[-0.02em] text-ink sm:text-2xl">
                  {briefTitle(latest.subject)}
                </h2>

                <p className="mt-1.5 text-sm text-muted-foreground">
                  {items.length > 0
                    ? `${items.length} vetted papers, tools, and releases from this week.`
                    : 'Selected papers, tools, and privacy research from this week.'}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <Button variant="default" asChild>
                    <Link to={`/brief/${latest.id}`}>Read weekly brief</Link>
                  </Button>
                  {hasPdf && (
                    <Button variant="outline" asChild>
                      <a href={`/api/reports/${latest.id}/pdf`} target="_blank" rel="noreferrer">
                        <ArrowDownToLine className="size-4" aria-hidden="true" />
                        Download PDF
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </Button>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3.5 text-xs">
                  {isSignedIn ? (
                    <Link
                      to="/feed"
                      className="rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Open your personalized feed
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => clerk.openSignIn()}
                      className="cursor-pointer rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Sign in to follow topics
                    </button>
                  )}
                  <Link
                    to="/archive"
                    className="rounded-sm font-medium text-muted-foreground underline-offset-4 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Browse archive ({reports.length})
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-xl font-medium text-ink">
                  Start with live topic search
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  No weekly brief has been published yet. Run a live search across six sources anytime.
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <Button variant="default" asChild>
                    <Link to="/studio">Open live search</Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/archive">View archive</Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Highlights from this week — visible above the fold at 1440×900, skeleton prevents CLS */}
        {!archiveDown && (highlightsLoading || previewItems.length > 0) && (
          <section aria-labelledby="highlights-heading" className="border-t border-border pt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="highlights-heading" className="font-display text-2xl font-medium tracking-[-0.02em] text-ink">
                Highlights from this week
              </h2>
              {latest && (
                <Link
                  to={`/brief/${latest.id}`}
                  className="inline-flex items-center gap-1 rounded-sm text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View full brief
                </Link>
              )}
            </div>

            {highlightsLoading ? (
              <div role="status" aria-label="Loading weekly highlights" className="mt-5 grid gap-4 md:grid-cols-3">
                <Skeleton className="h-44 w-full rounded-2xl" />
                <Skeleton className="h-44 w-full rounded-2xl" />
                <Skeleton className="h-44 w-full rounded-2xl" />
              </div>
            ) : (
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {previewItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex flex-col justify-between rounded-2xl border border-border bg-white p-5 transition-[border-color,transform,box-shadow] hover:border-primary/50 hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-ink">{sourceLabel(item.source)}</span>
                        <time dateTime={item.published} className="font-mono tabular-nums">
                          {formatDate(item.published, 'short')}
                        </time>
                      </div>
                      <h3 className="mt-2.5 line-clamp-2 font-display text-lg font-medium leading-snug text-ink transition-colors group-hover:text-primary">
                        {item.title}
                      </h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {item.summary}
                      </p>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      Read source
                      <ArrowUpRight className="size-3.5 transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5" aria-hidden="true" />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </span>
                  </a>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
