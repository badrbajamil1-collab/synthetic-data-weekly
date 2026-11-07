import { ArrowUpRight } from 'lucide-react'

import { FilterChip } from '@/components/filter-chip'
import { topicsFor } from '@/lib/feed'
import { formatDate, sourceLabel, type ReportItem } from '@/lib/report'

interface NewsListProps {
  items: ReportItem[]
  active: string | null
  onKeyword: (label: string) => void
}

export function NewsList({ items, active, onKeyword }: NewsListProps) {
  const newest = [...items].sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
  if (newest.length === 0) return null

  return (
    <section aria-labelledby="news-heading" className="mt-20 border-t border-border pt-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h3 id="news-heading" className="text-balance font-display text-3xl font-medium tracking-[-0.025em]">
          Headlines this week
        </h3>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          Newest first. Choose a key word to filter the feed above.
        </p>
      </div>

      <ol className="mt-8 divide-y divide-border">
        {newest.map((item) => {
          const topics = topicsFor(item)
          return (
            <li key={item.id} className="grid gap-2 py-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-8">
              <p className="text-sm text-muted-foreground">
                <span className="block font-medium text-ink/80">{sourceLabel(item.source)}</span>
                {formatDate(item.published, 'short')}
              </p>
              <div className="min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm break-words font-medium leading-6 text-ink transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.title}
                  <ArrowUpRight className="mb-0.5 ml-1 inline size-3.5" aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                {topics.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topics.map((label) => (
                      <FilterChip key={label} label={label} active={active === label} onToggle={() => onKeyword(label)} />
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
