import { ArrowRight, CalendarDays, Check, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { briefTitle, formatDate } from '@/lib/report'
import { Link, navigate } from '@/lib/router'
import { useReports } from '@/lib/use-report'

interface ArchivePageProps {
  isAdmin: boolean
  running: boolean
  onRunPipeline: () => void
}

/**
 * `/archive` (spec, public): every week, oldest to newest, each row opening
 * the week's brief at /brief/<id>. The admin pipeline button lives here.
 */
export function ArchivePage({ isAdmin, running, onRunPipeline }: ArchivePageProps) {
  const { reports, loading, error, retry } = useReports()
  const rows = [...reports].reverse()

  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.65fr_1.35fr] lg:gap-20">
        <div>
          <p className="text-sm font-semibold text-primary">Report archive</p>
          <h2 className="mt-3 text-balance font-display text-4xl font-medium tracking-[-0.03em]">Every week, kept in context.</h2>
          <p className="mt-5 max-w-md leading-7 text-muted-foreground">Return to an earlier brief without losing its rankings, source links, or editorial perspective.</p>
          {isAdmin && (
            <Button className="mt-6" variant="ink" onClick={onRunPipeline} disabled={running}>
              <RefreshCw aria-hidden="true" />
              {running ? 'Running the pipeline…' : 'Run the pipeline now'}
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-[24px] border border-border bg-white shadow-[0_20px_60px_-42px_rgba(16,42,67,0.4)]">
          {error && (
            <div className="flex items-center justify-between gap-4 p-6 text-sm text-destructive" role="alert">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={retry}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          )}
          {loading && <div className="space-y-5 p-6"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>}
          {!loading && !error && rows.length === 0 && (
            <div className="px-6 py-16 text-center">
              <p className="text-balance font-display text-2xl text-ink">Your first brief starts with the pipeline.</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Publish a completed weekly report and it will be archived here.</p>
            </div>
          )}
          {!loading && rows.map((report, index) => {
            const activeReport = false
            return (
              <div key={report.id}>
                {index > 0 && <Separator />}
                <button
                  type="button"
                  onClick={() => navigate(`/brief/${report.id}`)}
                  className="group flex w-full items-center gap-4 px-5 py-6 text-left transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-7"
                >
                  <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${activeReport ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground'}`}>
                    {activeReport ? <Check className="size-5" aria-hidden="true" /> : <CalendarDays className="size-5" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-display text-lg font-medium leading-snug text-ink">{briefTitle(report.subject)}</span>
                    <span className="mt-1.5 block text-sm text-muted-foreground">Week ending {formatDate(report.week_end, 'short')}</span>
                  </span>
                  <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" aria-hidden="true" />
                </button>
              </div>
            )
          })}
          {!loading && rows.length > 0 && (
            <div className="px-5 py-3 text-xs text-muted-foreground sm:px-7">
              Oldest to newest. Open a week to read the brief. Everything is also reachable from each brief's <Link to="/archive" className="underline decoration-primary/40 underline-offset-4 hover:text-primary">archive</Link>.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
