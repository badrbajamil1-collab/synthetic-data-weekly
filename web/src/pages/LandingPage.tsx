import { ArrowDownToLine, ArrowRight, CircleAlert, Clock3, RefreshCw, ShieldCheck } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/react'

import { Badge } from '@/components/ui/badge'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { NumberTicker } from '@/components/ui/number-ticker'
import { SignalVisual } from '@/components/signal-visual'
import { navigate } from '@/lib/router'
import { briefTitle } from '@/lib/report'
import { useReport, useReports } from '@/lib/use-report'

/**
 * `/` (spec): one screen — hero, a compact "inside this week" card, CTA.
 * No info sections; a signed-in reader still sees the landing (the logo and
 * the Library link are the way home).
 */
export function LandingPage() {
  const clerk = useClerk()
  // A signed-in reader was still offered "Sign in to your feed", which opened the
  // sign-in modal for an account that is already signed in (WEB-04).
  const { isSignedIn } = useAuth()
  const { reports, error: reportsError, retry: retryReports } = useReports()
  const latest = reports[0] ?? null
  const { items, error: itemsError, retry: retryItem } = useReport(latest?.id ?? null)
  const archiveDown = Boolean(reportsError) || (reports.length > 0 && Boolean(itemsError))

  const sourceCount = new Set(items.map((item) => item.source)).size
  const averageScore = items.length
    ? items.reduce((total, item) => total + Number(item.score || 0), 0) / items.length
    : 0

  return (
    <section className="mx-auto max-w-7xl px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20">
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

      <div className="grid items-center gap-12 grid-cols-[minmax(0,1fr)] lg:grid-cols-[1.02fr_0.98fr] lg:gap-16">
        <BlurFade direction="up" duration={0.4} className="min-w-0">
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
              {isSignedIn ? (
                <Button size="lg" variant="ink" onClick={() => navigate('/feed')}>
                  Go to your feed
                  <ArrowRight aria-hidden="true" />
                </Button>
              ) : (
                <Button size="lg" variant="ink" onClick={() => clerk.openSignIn()}>
                  Sign in to your feed
                  <ArrowRight aria-hidden="true" />
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                onClick={() => (latest ? navigate(`/brief/${latest.id}`) : undefined)}
                disabled={!latest}
              >
                Read the latest brief
              </Button>
              {latest?.has_pdf && (
                <Button size="lg" variant="ghost" asChild>
                  <a href={`/api/reports/${latest.id}/pdf`}>
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

      {!archiveDown && (
        <div className="mt-16 grid grid-cols-2 border-y border-border py-7 sm:grid-cols-4 sm:py-8">
          {[
            { label: 'Reports archived', value: reports.length, decimals: 0 },
            { label: 'Findings in this brief', value: items.length, decimals: 0 },
            { label: 'Sources represented', value: sourceCount, decimals: 0 },
            { label: 'Average relevance', value: averageScore, decimals: 1 },
          ].map((stat, index) => (
            <div
              key={stat.label}
              className={`px-4 py-4 sm:px-7 sm:py-0 ${index > 0 ? 'sm:border-l sm:border-border' : ''} ${index === 1 ? 'border-l border-border' : ''} ${index >= 2 ? 'border-t border-border sm:border-t-0' : ''}`}
            >
              <NumberTicker value={stat.value} decimalPlaces={stat.decimals} className="font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl" />
              <p className="mt-1.5 text-sm text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {!archiveDown && latest && (
        <div className="mt-8 rounded-2xl border border-border bg-white/70 px-6 py-5 text-sm text-muted-foreground sm:flex sm:items-center sm:justify-between">
          <p>
            Inside this week: <span className="font-medium text-ink">{briefTitle(latest.subject)}</span>
            {' '}— {items.length} findings checked across {sourceCount} sources.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 shrink-0 sm:mt-0" onClick={() => navigate(`/brief/${latest.id}`)}>
            Open the brief
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  )
}
