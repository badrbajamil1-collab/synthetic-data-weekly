import { useState } from 'react'
import { ArrowDownToLine, ArrowRight, CircleAlert, Clock3, Radio, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/react'

import { Badge } from '@/components/ui/badge'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { NumberTicker } from '@/components/ui/number-ticker'
import { SignalVisual } from '@/components/signal-visual'
import { navigate } from '@/lib/router'
import { briefTitle } from '@/lib/report'
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
    <section className="mx-auto max-w-7xl px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16">
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

      <div className="grid items-center gap-12 grid-cols-[minmax(0,1fr)] lg:grid-cols-[1.04fr_0.96fr] lg:gap-16">
        <BlurFade direction="up" duration={0.4} className="min-w-0">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-mint/25 bg-[#e9f7f3] px-3 py-1.5 text-[#146c63]">
                <ShieldCheck aria-hidden="true" />
                Numbers checked against their sources
              </Badge>
              <Badge variant="outline" className="border-primary/25 bg-primary/8 px-3 py-1.5 text-primary">
                <Radio className="size-3.5 text-emerald-500" aria-hidden="true" />
                Live LangGraph.js Engine
              </Badge>
            </div>

            <h1 className="mt-6 max-w-2xl text-balance font-display text-[clamp(2.6rem,5.5vw,4.75rem)] font-medium leading-[1.02] tracking-[-0.04em] text-ink">
              Privacy-first synthetic data intelligence, live & weekly.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Run an on-demand LangGraph.js research check across arXiv, GitHub, Hacker News, and lab blogs right now — or browse the curated weekly brief for Well7 Research Lab.
            </p>

            {/* Quick Live Check Bar */}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                openStudioWith(quickQuery)
              }}
              className="mt-7 flex max-w-xl flex-col gap-2.5 rounded-2xl border border-border bg-white p-2 shadow-sm sm:flex-row"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="search"
                  value={quickQuery}
                  onChange={(event) => setQuickQuery(event.target.value)}
                  placeholder="Check a topic live (e.g. clinical tabular privacy)…"
                  className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none"
                />
              </div>
              <Button type="submit" variant="ink" className="h-11 rounded-xl px-5">
                <Radio className="size-3.5 text-emerald-400" aria-hidden="true" />
                Check Live Now
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
            <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="size-4" aria-hidden="true" />
              On-demand checks anytime · Full brief archived every Saturday
            </p>
          </div>
        </BlurFade>

        <BlurFade direction="left" delay={0.12} duration={0.6} className="min-w-0">
          <SignalVisual itemCount={items.length} sourceCount={sourceCount} averageScore={averageScore} />
        </BlurFade>
      </div>

      {!archiveDown && (
        <div className="mt-16 grid grid-cols-2 rounded-2xl border border-border/80 bg-white py-6 shadow-2xs sm:grid-cols-4 sm:py-7">
          {[
            { label: 'Reports archived', value: reports.length, decimals: 0 },
            { label: 'Findings in this brief', value: items.length, decimals: 0 },
            { label: 'Sources represented', value: sourceCount, decimals: 0 },
            { label: 'Average relevance', value: averageScore, decimals: 1 },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className={`px-5 py-3 sm:px-7 sm:py-0 ${index > 0 ? 'sm:border-l sm:border-border' : ''} ${index === 1 ? 'border-l border-border' : ''} ${index >= 2 ? 'border-t border-border sm:border-t-0' : ''}`}
            >
              <NumberTicker value={stat.value} decimalPlaces={stat.decimals} className="font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl" />
              <p className="mt-1.5 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {!archiveDown && latest && (
        <div className="mt-8 rounded-2xl border border-border/80 bg-white px-6 py-5 text-sm text-muted-foreground shadow-2xs sm:flex sm:items-center sm:justify-between">
          <p>
            Latest weekly brief: <span className="font-semibold text-ink">{briefTitle(latest.subject)}</span>
            {' '}— {items.length} findings checked across {sourceCount} sources.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 sm:mt-0">
            <Button variant="outline" size="sm" onClick={() => navigate('/studio')}>
              <Radio className="size-3.5 text-emerald-500" aria-hidden="true" />
              Live Studio
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(`/brief/${latest.id}`)}>
              Open the brief
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
