import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, CircleAlert, FileText, Mail, RefreshCw } from 'lucide-react'

import { Link } from '@/components/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { errorText, fetchSubscribers, type SubscriberInfo } from '@/lib/api'
import { briefTitle, formatDate } from '@/lib/report'
import { useReports } from '@/lib/use-report'
import { cn } from '@/lib/utils'

interface ArchivePageProps {
  isAdmin: boolean
  running: boolean
  pipelineError: string | null
  onRunPipeline: () => void
}

function WeeklyEmailSubscribersPanel() {
  const [subscribers, setSubscribers] = useState<SubscriberInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchSubscribers()
      .then((list) => {
        if (active) setSubscribers(list)
      })
      .catch((err) => {
        if (active) setError(errorText(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="mt-6 rounded-2xl border border-border bg-[#fffdf9] p-4 shadow-[0_4px_14px_rgba(14,62,64,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-primary">
          <Mail className="size-4 shrink-0" aria-hidden="true" />
          Weekly email list
        </h2>
        {!loading && !error && (
          <Badge variant="secondary" className="font-mono text-[11px] tabular-nums">
            {subscribers.length}
          </Badge>
        )}
      </div>

      {loading && (
        <div className="mt-3 space-y-2" role="status" aria-label="Loading weekly email subscribers">
          <Skeleton className="h-5 w-full rounded-md" />
          <Skeleton className="h-5 w-4/5 rounded-md" />
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && subscribers.length === 0 && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          No signed-in web subscribers yet. Anyone who signs in is added automatically.
        </p>
      )}

      {!loading && !error && subscribers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {subscribers.map((sub) => (
            <li
              key={sub.user_id}
              className="flex items-baseline justify-between gap-2 border-t border-border/70 pt-2 text-xs first:border-t-0 first:pt-0"
            >
              <span className="truncate font-semibold text-ink">{sub.username}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">{sub.email}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-border/70 pt-2.5 text-[11px] leading-4 text-muted-foreground">
        Static recipients in <code className="font-mono">config.yaml</code> are also included automatically on Saturday sends.
      </p>
    </div>
  )
}

/**
 * `/archive` (public): every published week, newest to oldest, linking to /brief/<id>.
 */
export function ArchivePage({ isAdmin, running, pipelineError, onRunPipeline }: ArchivePageProps) {
  const { reports, loading, error, retry } = useReports()

  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      {pipelineError && (
        <div className="mb-8 flex items-center gap-2.5 rounded-2xl border border-destructive/25 bg-[#fff5f7] px-4 py-3 text-sm text-destructive" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>{pipelineError}</span>
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-[0.65fr_1.35fr] lg:gap-16">
        <div>
          <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.02em] text-primary sm:text-4xl">
            Weekly report archive
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Every edition kept in context — return to any earlier brief without losing its rankings, source links, PDF edition, or editorial notes.
          </p>
          {isAdmin && (
            <>
              <Button
                className="mt-6"
                variant="default"
                onClick={onRunPipeline}
                disabled={running}
                aria-busy={running}
              >
                <RefreshCw className={cn(running && 'motion-safe:animate-spin')} aria-hidden="true" />
                {running ? 'Running the pipeline…' : 'Run the pipeline now'}
              </Button>

              <WeeklyEmailSubscribersPanel />
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-[#fffdf9] shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
          {error && (
            <div className="flex flex-wrap items-center justify-between gap-4 p-6 text-sm text-destructive" role="alert">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={retry}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          )}

          {loading && (
            <div role="status" aria-label="Loading weekly archive" className="space-y-4 p-6">
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          )}

          {!loading && !error && reports.length === 0 && (
            <div className="px-6 py-16 text-center">
              <h2 className="text-balance font-display text-2xl font-medium text-primary">
                No briefs archived yet.
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Publish a completed weekly report and it will appear here.
              </p>
            </div>
          )}

          {!loading && reports.length > 0 && (
            <ul>
              {reports.map((report, index) => {
                const isLatest = index === 0
                return (
                  <li key={report.id}>
                    {index > 0 && <Separator />}
                    <Link
                      to={`/brief/${report.id}`}
                      className="group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-secondary/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7 sm:py-6"
                    >
                      <span
                        className={cn(
                          'grid size-11 shrink-0 place-items-center rounded-xl',
                          isLatest ? 'bg-primary text-[#faf4ec]' : 'bg-secondary text-muted-foreground',
                        )}
                      >
                        <CalendarDays className="size-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="break-words font-display text-lg font-semibold leading-snug text-primary transition-colors group-hover:text-[#b46319]">
                            {briefTitle(report.subject)}
                          </span>
                          {isLatest && (
                            <Badge variant="secondary">
                              Latest
                            </Badge>
                          )}
                          {Boolean(report.has_pdf) && (
                            <Badge variant="outline">
                              <FileText className="size-3" aria-hidden="true" />
                              PDF
                            </Badge>
                          )}
                        </span>
                        <span className="mt-1 block font-mono text-xs text-muted-foreground">
                          Week ending {formatDate(report.week_end, 'short')}
                        </span>
                      </span>
                      <ArrowRight
                        className="size-5 shrink-0 text-[#b46319] transition-transform motion-safe:group-hover:translate-x-1"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          {!loading && reports.length > 0 && (
            <div className="border-t border-border bg-secondary/50 px-5 py-3 text-xs text-muted-foreground sm:px-7">
              Newest to oldest. Select any week to read its brief.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
