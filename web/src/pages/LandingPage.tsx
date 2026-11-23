import { useId, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowRight, CalendarDays, CircleAlert, RefreshCw, Search } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/react'

import { HorizonRibbon } from '@/components/horizon-ribbon'
import { Link } from '@/components/link'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { topicsFor } from '@/lib/feed'
import { briefTitle, formatDate, sourceLabel } from '@/lib/report'
import { estimateBriefMinutes, estimateItemMinutes, useRitualProgress } from '@/lib/ritual'
import { navigate } from '@/lib/router'
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

  const { readCount, totalCount, percent, markRead } = useRitualProgress(latest?.id ?? null, items)
  const briefMinutes = estimateBriefMinutes(items)

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
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-7 sm:px-8 sm:pt-9">
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

        {/* Horizon Hero Banner: deep coastal teal with harmonic silk ribbon canvas & frosted ritual check-in card */}
        <section className="relative grid gap-8 overflow-hidden rounded-[28px] bg-[#0e3e40] p-7 text-[#faf4ec] shadow-[0_24px_60px_rgba(14,62,64,0.16)] sm:p-10 lg:grid-cols-[1.12fr_0.88fr] lg:items-center lg:gap-10 lg:p-11">
          <HorizonRibbon variant="hero" />

          <div className="relative z-10">
            <h1 className="max-w-[18ch] text-balance font-display text-4xl font-normal leading-[1.08] tracking-[-0.02em] text-[#faf4ec] sm:text-5xl">
              Your weekly anchor in <em className="italic text-[#f0c281]">privacy-safe</em> synthetic data.
            </h1>

            <p className="mt-4 max-w-[54ch] text-sm leading-6 text-[#faf4ec]/85 sm:text-base sm:leading-7">
              18 sources across arXiv, GitHub, research blogs, Hacker News, and news — ranked every Saturday for privacy-first tabular and time-series work, or searched live on demand.
            </p>

            <search className="mt-6 max-w-xl">
              <form
                onSubmit={handleSearchSubmit}
                className="flex flex-col gap-2 rounded-3xl border border-white/30 bg-[#fffdf9]/97 p-1.5 shadow-sm transition-colors focus-within:ring-2 focus-within:ring-[#f0c281] sm:flex-row sm:items-center sm:rounded-full sm:pl-4"
              >
                <div className="relative flex flex-1 items-center">
                  <label htmlFor={searchInputId} className="sr-only">
                    Search synthetic data topics live
                  </label>
                  <Search className="pointer-events-none ml-2.5 size-4 shrink-0 text-muted-foreground sm:ml-0" aria-hidden="true" />
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
                    placeholder="Search topics (EHR, copula, DP)…"
                    className="h-10 w-full bg-transparent px-3 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none"
                  />
                </div>
                <Button type="submit" variant="amber" className="h-10 shrink-0 px-5">
                  Search live
                </Button>
              </form>
            </search>
          </div>

          {/* Frosted Ritual Edition Card */}
          <div className="relative z-10 rounded-[22px] border border-[#faf4ec]/25 bg-[#fffdf9]/10 p-6 backdrop-blur-md">
            {reportsLoading ? (
              <div role="status" aria-label="Loading latest edition" className="space-y-3">
                <Skeleton className="h-4 w-28 bg-[#faf4ec]/20" />
                <Skeleton className="h-7 w-56 bg-[#faf4ec]/20" />
                <Skeleton className="h-4 w-44 bg-[#faf4ec]/20" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-10 w-36 rounded-full bg-[#faf4ec]/20" />
                  <Skeleton className="h-10 w-28 rounded-full bg-[#faf4ec]/20" />
                </div>
              </div>
            ) : latest ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#f0c281] tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="size-3.5" aria-hidden="true" />
                    Latest edition ({formatDate(latest.week_end, 'short')})
                  </span>
                  {briefMinutes > 0 && <span>{briefMinutes} min read</span>}
                </div>

                <h2 className="mt-2 font-display text-2xl font-normal leading-tight text-[#faf4ec] sm:text-[28px]">
                  {briefTitle(latest.subject)}
                </h2>

                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#faf4ec]/85">
                  {previewItems.length > 0
                    ? `${items.length} vetted ${items.length === 1 ? 'pick' : 'picks'} this week — led by ${previewItems[0].title}.`
                    : 'Selected papers, tools, and privacy research from this week.'}
                </p>

                {totalCount > 0 && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-[#faf4ec]/90">
                      <span>This week’s calm check-in</span>
                      <span className="font-mono tabular-nums">
                        {readCount} of {totalCount} {totalCount === 1 ? 'highlight' : 'highlights'} read
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

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <Link
                    to={`/brief/${latest.id}`}
                    className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-[#faf4ec] px-5 py-2 text-center text-sm font-bold text-[#0e3e40] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                  >
                    Start reading brief
                  </Link>
                  {hasPdf && (
                    <a
                      href={`/api/reports/${latest.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-[#faf4ec]/35 bg-[#faf4ec]/10 px-4 py-2 text-sm font-semibold text-[#faf4ec] transition-colors hover:bg-[#faf4ec]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                    >
                      <ArrowDownToLine className="size-4" aria-hidden="true" />
                      Open PDF
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#faf4ec]/20 pt-3.5 text-xs">
                  {isSignedIn ? (
                    <Link
                      to="/feed"
                      className="rounded-sm font-semibold text-[#f0c281] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                    >
                      Open your personalized feed
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => clerk.openSignIn()}
                      className="cursor-pointer rounded-sm font-semibold text-[#f0c281] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                    >
                      Sign in to follow topics
                    </button>
                  )}
                  <Link
                    to="/archive"
                    className="rounded-sm font-medium text-[#faf4ec]/80 underline-offset-4 hover:text-[#faf4ec] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                  >
                    Browse archive ({reports.length})
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h2 className="font-display text-2xl font-normal text-[#faf4ec]">
                  Start with live topic search
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#faf4ec]/85">
                  No weekly brief has been published yet. Run a live search across six sources anytime.
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <Link
                    to="/studio"
                    className="inline-flex min-h-10 items-center justify-center rounded-full bg-[#faf4ec] px-5 py-2 text-sm font-bold text-[#0e3e40] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                  >
                    Open live search
                  </Link>
                  <Link
                    to="/archive"
                    className="inline-flex min-h-10 items-center justify-center rounded-full border border-[#faf4ec]/35 bg-[#faf4ec]/10 px-4 py-2 text-sm font-semibold text-[#faf4ec] transition-colors hover:bg-[#faf4ec]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f0c281]"
                  >
                    View archive
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Highlights from this week */}
        {!archiveDown && (highlightsLoading || previewItems.length > 0) && (
          <section aria-labelledby="highlights-heading" className="mt-9">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="highlights-heading" className="font-display text-2xl font-medium tracking-[-0.02em] text-primary">
                Top highlights
              </h2>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span className="font-mono text-[#b46319]">18 sources, Saturday 08:00</span>
                {latest && (
                  <Link
                    to={`/brief/${latest.id}`}
                    className="inline-flex items-center gap-1 rounded-sm font-semibold text-primary underline-offset-4 hover:text-[#b46319] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    View full brief
                  </Link>
                )}
              </div>
            </div>

            {highlightsLoading ? (
              <div role="status" aria-label="Loading weekly highlights" className="mt-4 grid gap-5 md:grid-cols-3">
                <Skeleton className="h-52 w-full rounded-[18px]" />
                <Skeleton className="h-52 w-full rounded-[18px]" />
                <Skeleton className="h-52 w-full rounded-[18px]" />
              </div>
            ) : (
              <div className="mt-4 grid gap-5 md:grid-cols-3">
                {previewItems.map((item) => {
                  const matchedTopics = topicsFor(item).slice(0, 2)
                  const readMins = estimateItemMinutes(item)
                  const targetHref = latest ? `/brief/${latest.id}?item=${encodeURIComponent(item.id)}` : '/brief'
                  return (
                    <Link
                      key={item.id}
                      to={targetHref}
                      onClick={() => markRead(item.id)}
                      className="group flex flex-col justify-between rounded-[18px] border border-border bg-[#fffdf9] p-5 shadow-[0_6px_18px_rgba(14,62,64,0.05)] transition-[border-color,transform] hover:border-[#b46319] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:hover:-translate-y-0.5 sm:p-6"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 font-mono text-[11px] font-semibold text-[#b46319] tabular-nums">
                          <span>{sourceLabel(item.source)}</span>
                          <span>{readMins} min read</span>
                        </div>
                        <h3 className="mt-2.5 line-clamp-2 font-display text-lg font-semibold leading-snug text-primary transition-colors group-hover:text-[#b46319] sm:text-xl">
                          {item.title}
                        </h3>
                        <p className="mt-2.5 line-clamp-3 text-sm leading-6 text-muted-foreground">
                          {item.summary}
                        </p>
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/80 pt-3 text-xs font-semibold text-primary">
                        <span className="truncate text-muted-foreground">
                          {matchedTopics.length > 0 ? matchedTopics.join(', ') : 'Synthetic data'}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-primary group-hover:text-[#b46319]">
                          Read summary
                          <ArrowRight className="size-3.5 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden="true" />
                        </span>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
