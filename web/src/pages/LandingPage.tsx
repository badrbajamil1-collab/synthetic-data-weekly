import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowDownToLine, ArrowUpRight, CircleAlert, MoveRight, RefreshCw, Search } from 'lucide-react'
import { useAuth, useClerk } from '@clerk/react'

import { Button } from '@/components/ui/button'
import { navigate } from '@/lib/router'
import { formatDate, sourceLabel } from '@/lib/report'
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

  const [titleNumber, setTitleNumber] = useState(0)
  const titles = useMemo(
    () => ['privacy-first', 'searchable', 'curated', 'practical', 'open-source'],
    [],
  )

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (titleNumber === titles.length - 1) {
        setTitleNumber(0)
      } else {
        setTitleNumber(titleNumber + 1)
      }
    }, 2000)
    return () => clearTimeout(timeoutId)
  }, [titleNumber, titles])

  function openStudioWith(q: string) {
    if (onLaunchStudio) onLaunchStudio(q)
    navigate('/studio')
  }

  const previewItems = items.slice(0, 3)

  return (
    <div className="w-full">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        {archiveDown && (
          <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
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

        <div className="flex flex-col items-center justify-center gap-8 py-20 lg:py-32">
          <div>
            <Button
              variant="secondary"
              size="sm"
              className="gap-4"
              onClick={() => (latest ? navigate(`/brief/${latest.id}`) : navigate('/archive'))}
            >
              {latest
                ? `Read this week's brief (${formatDate(latest.week_end, 'short')})`
                : 'Browse the weekly archive'}
              <MoveRight className="size-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-col items-center gap-4">
            <h1 className="max-w-3xl text-center font-display text-5xl font-normal tracking-tighter text-ink md:text-7xl">
              <span>Synthetic data research,</span>
              <span className="relative flex w-full justify-center overflow-hidden text-center text-primary md:pb-4 md:pt-1">
                &nbsp;
                {titles.map((title, index) => (
                  <motion.span
                    key={title}
                    className="absolute font-semibold"
                    initial={{ opacity: 0, y: -100 }}
                    transition={{ type: 'spring', stiffness: 50 }}
                    animate={
                      titleNumber === index
                        ? {
                            y: 0,
                            opacity: 1,
                          }
                        : {
                            y: titleNumber > index ? -150 : 150,
                            opacity: 0,
                          }
                    }
                  >
                    {title}
                  </motion.span>
                ))}
              </span>
            </h1>

            <p className="max-w-2xl text-center text-lg leading-relaxed tracking-tight text-muted-foreground md:text-xl">
              Keeping up with new synthetic data papers, privacy methods, and open-source tools shouldn't take hours of sifting through noise. Search live across sources anytime or read the curated weekly brief.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              openStudioWith(quickQuery)
            }}
            className="flex w-full max-w-xl flex-col gap-2 rounded-2xl border border-border/90 bg-white p-2 shadow-2xs sm:flex-row"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={quickQuery}
                onChange={(event) => setQuickQuery(event.target.value)}
                placeholder="Search any topic live (e.g. tabular privacy, clinical EHR)…"
                className="h-11 w-full rounded-xl bg-transparent pl-10 pr-3 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
            <Button type="submit" variant="ink" className="h-11 rounded-xl px-5">
              Search live <MoveRight className="size-4" aria-hidden="true" />
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              variant="outline"
              className="gap-3"
              onClick={() => (latest ? navigate(`/brief/${latest.id}`) : undefined)}
              disabled={!latest}
            >
              Read the weekly brief <MoveRight className="size-4" aria-hidden="true" />
            </Button>
            {isSignedIn ? (
              <Button size="lg" className="gap-3" onClick={() => navigate('/feed')}>
                Open your feed <MoveRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button size="lg" className="gap-3" onClick={() => clerk.openSignIn()}>
                Sign in to follow topics <MoveRight className="size-4" aria-hidden="true" />
              </Button>
            )}
            {latest?.has_pdf && (
              <Button size="lg" variant="ghost" asChild>
                <a href={`/api/reports/${latest.id}/pdf`} target="_blank" rel="noopener">
                  <ArrowDownToLine className="size-4" aria-hidden="true" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Clean 3-card preview of the latest papers — no accuracy/pipeline jargon */}
        {!archiveDown && previewItems.length > 0 && (
          <div className="border-t border-border/80 pb-20 pt-12">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-display text-2xl font-medium tracking-[-0.02em] text-ink">
                Highlights from this week
              </h2>
              {latest && (
                <button
                  type="button"
                  onClick={() => navigate(`/brief/${latest.id}`)}
                  className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  View full brief <MoveRight className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {previewItems.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex flex-col justify-between rounded-2xl border border-border/75 bg-white p-5 transition-colors hover:border-primary/40"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-ink/80">{sourceLabel(item.source)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(item.published, 'short')}</span>
                    </div>
                    <h3 className="mt-2 line-clamp-2 font-display text-lg font-medium leading-snug text-ink group-hover:text-primary">
                      {item.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {item.summary}
                    </p>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                    Read source
                    <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
