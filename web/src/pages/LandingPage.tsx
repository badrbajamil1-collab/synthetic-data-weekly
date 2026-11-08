import { useState } from 'react'
import { ArrowDownToLine, ArrowRight, CircleAlert, RefreshCw, Search } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/react'

import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { NumberTicker } from '@/components/ui/number-ticker'
import { SignalVisual } from '@/components/signal-visual'
import { navigate } from '@/lib/router'
import { useReport, useReports } from '@/lib/use-report'

interface LandingPageProps {
  onLaunchStudio?: (query: string) => void
}

export function LandingPage({ onLaunchStudio }: LandingPageProps) {
  const clerk = useClerk()
  const { isSignedIn } = useAuth()
  const { reports, error: reportsError, retry: retryReports } = useReports()
  const latest = reports[0] ?? null
  const { items, error: itemsError, retry: retryItem } = useReport(latest?.id ?? null)
  const archiveDown = Boolean(reportsError) || (reports.length > 0 && Boolean(itemsError))
  const [quickQuery, setQuickQuery] = useState('')

  const sourceCount = new Set(items.map((item) => item.source)).size
  const averageScore = items.length
    ? items.reduce((total, item) => total + Number(item.score || 0), 0) / items.length
    : 0

  function openStudioWith(q: string) {
    if (onLaunchStudio) onLaunchStudio(q)
    navigate('/studio')
  }

  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-14 sm:px-8 sm:pb-24 sm:pt-20">
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

      <div className="grid items-center gap-12 grid-cols-[minmax(0,1fr)] lg:grid-cols-[1.06fr_0.94fr] lg:gap-16">
        <BlurFade direction="up" duration={0.4} className="min-w-0">
          <div>
            <h1 className="max-w-2xl text-balance font-display text-[clamp(2.5rem,5vw,4.35rem)] font-medium leading-[1.04] tracking-[-0.035em] text-ink">
              Privacy-first synthetic data intelligence, live & weekly.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Search live across arXiv, GitHub, Hacker News, and research blogs for new papers and open-source tools — or read the curated weekly brief for Well7 Research Lab.
            </p>

            {/* Quick Live Search Bar */}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                openStudioWith(quickQuery)
              }}
              className="mt-8 flex max-w-xl flex-col gap-2 rounded-2xl border border-border/90 bg-white p-2 sm:flex-row"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={quickQuery}
                  onChange={(event) => setQuickQuery(event.target.value)}
                  placeholder="Search a topic live (e.g. clinical tabular privacy)…"
                  className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none"
                />
              </div>
              <Button type="submit" variant="ink" className="h-11 rounded-xl px-5">
                Search live
              </Button>
            </form>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                variant="outline"
                onClick={() => (latest ? navigate(`/brief/${latest.id}`) : undefined)}
                disabled={!latest}
              >
                Read the latest brief
                <ArrowRight aria-hidden="true" />
              </Button>
              {isSignedIn ? (
                <Button size="lg" variant="ghost" onClick={() => navigate('/feed')}>
                  Open your feed
                </Button>
              ) : (
                <Button size="lg" variant="ghost" onClick={() => clerk.openSignIn()}>
                  Sign in to follow topics
                </Button>
              )}
              {latest?.has_pdf && (
                <Button size="lg" variant="ghost" asChild>
                  <a href={`/api/reports/${latest.id}/pdf`} target="_blank" rel="noopener">
                    <ArrowDownToLine aria-hidden="true" />
                    Download PDF
                  </a>
                </Button>
              )}
            </div>
          </div>
        </BlurFade>

        <BlurFade direction="left" delay={0.1} duration={0.5} className="min-w-0">
          <SignalVisual items={items} reportId={latest?.id} weekEnd={latest?.week_end} />
        </BlurFade>
      </div>

      {!archiveDown && (
        <div className="mt-16 grid grid-cols-2 border-t border-border/80 pt-10 sm:grid-cols-4">
          {[
            { label: 'Reports archived', value: reports.length, decimals: 0 },
            { label: 'Findings in this brief', value: items.length, decimals: 0 },
            { label: 'Sources represented', value: sourceCount, decimals: 0 },
            { label: 'Average relevance', value: averageScore, decimals: 1 },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className={`py-3 sm:py-0 ${index > 0 ? 'sm:border-l sm:border-border/70 sm:pl-8' : ''} ${index === 1 ? 'border-l border-border/70 pl-5' : ''} ${index >= 2 ? 'border-t border-border/70 pt-5 sm:border-t-0 sm:pt-0' : ''} ${index === 3 ? 'pl-5' : ''}`}
            >
              <NumberTicker value={stat.value} decimalPlaces={stat.decimals} className="font-display text-3xl font-medium tracking-[-0.03em] text-ink tabular-nums sm:text-4xl" />
              <p className="mt-1 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
