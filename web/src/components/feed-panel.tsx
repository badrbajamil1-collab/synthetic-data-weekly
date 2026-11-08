import { Search } from 'lucide-react'

import { FilterChip } from '@/components/filter-chip'
import { FollowToggle } from '@/components/follow-toggle'
import { PaperActions } from '@/components/paper-actions'
import { ReportItemRow } from '@/components/report-item'
import { Button } from '@/components/ui/button'
import type { LibraryEntry } from '@/lib/api'
import { topicsFor, type FeedSection, type FeedView } from '@/lib/feed'
import { formatDate, type Report, type ReportItem } from '@/lib/report'
import { Link } from '@/lib/router'
import { sameSource, type TopicFollow, type TopicKind } from '@/lib/topics'
import { cn } from '@/lib/utils'

const VIEW_LABELS: Record<FeedView, string> = {
  all: 'Everything this week',
  read_later: 'Read later',
  important: 'Important',
}

const SECTION_OPTIONS: Array<{ value: FeedSection; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'top', label: 'Top picks' },
  { value: 'tool', label: 'Tools' },
  { value: 'worth', label: 'Worth a look' },
]

/** A weekly archive grows forever; the sticky rail shows the recent run and
 *  links out, so it cannot push "Your feed" off the bottom of the viewport. */
const MAX_SIDEBAR_WEEKS = 6

interface FeedSidebarProps {
  reports: Report[]
  selectedId: string | null
  onSelectWeek: (id: string) => void
  view: FeedView
  viewCounts: Record<FeedView, number>
  onView: (view: FeedView) => void
}

export function FeedSidebar({ reports, selectedId, onSelectWeek, view, viewCounts, onView }: FeedSidebarProps) {
  return (
    <aside aria-label="Your feed" className="order-last mb-12 lg:order-none lg:sticky lg:top-28 lg:mb-0 lg:self-start">
      <h3 className="font-display text-2xl font-medium tracking-[-0.02em]">Your feed</h3>

      <nav aria-label="Views" className="mt-5 flex flex-wrap gap-2">
        {(Object.keys(VIEW_LABELS) as FeedView[]).map((key) => {
          const active = view === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onView(key)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-ink bg-ink text-white'
                  : 'border-border bg-white text-ink/80 hover:border-primary/40 hover:text-primary',
              )}
            >
              {VIEW_LABELS[key]}
              <span
                className={cn(
                  'rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums',
                  active ? 'bg-white/20 text-white' : 'bg-secondary text-muted-foreground',
                )}
              >
                {viewCounts[key]}
              </span>
            </button>
          )
        })}
      </nav>

      <h4 className="mt-10 text-sm font-semibold text-muted-foreground">Weeks</h4>
      <ul className="mt-3 flex flex-wrap gap-2">
        {reports.slice(0, MAX_SIDEBAR_WEEKS).map((report) => {
          const active = report.id === selectedId
          return (
            <li key={report.id}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelectWeek(report.id)}
                className={cn(
                  'inline-flex rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
                    : 'border-border bg-white text-ink/80 hover:border-primary/40 hover:text-primary',
                )}
              >
                Week ending {formatDate(report.week_end, 'short')}
              </button>
            </li>
          )
        })}
      </ul>

      {reports.length > MAX_SIDEBAR_WEEKS && (
        <Link
          to="/archive"
          className="mt-3 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          All {reports.length} weeks in the archive
        </Link>
      )}
    </aside>
  )
}

interface FeedFilterBarProps {
  query: string
  onQuery: (query: string) => void
  section: FeedSection
  onSection: (section: FeedSection) => void
  sectionCounts: Record<FeedSection, number>
  activeFilters: number
  onClear: () => void
}

export function FeedFilterBar({
  query,
  onQuery,
  section,
  onSection,
  sectionCounts,
  activeFilters,
  onClear,
}: FeedFilterBarProps) {
  return (
    <div className="flex flex-col gap-4">
      <label className="relative block">
        <span className="sr-only">Search this brief</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
          name="q"
          value={query}
          autoComplete="off"
          onChange={(event) => onQuery(event.target.value)}
          placeholder="e.g. privacy, tabular, evaluation…"
          className="w-full rounded-xl border border-border bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Section" className="flex flex-wrap gap-2">
          {SECTION_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              count={sectionCounts[option.value]}
              active={section === option.value}
              onToggle={() => onSection(option.value)}
            />
          ))}
        </div>
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}

interface KeywordStripProps {
  counts: Array<{ label: string; count: number }>
  active: string | null
  onToggle: (label: string) => void
  /** When provided, every chip is followable: a small star sits beside it. */
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, label: string, next: boolean) => void
}

export function KeywordStrip({ counts, active, onToggle, follows, onFollow }: KeywordStripProps) {
  if (counts.length === 0) return null

  return (
    <div className="mt-10">
      <p className="text-sm font-semibold text-muted-foreground">Key words this week</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {counts.map((keyword) => {
          const chip = (
            <FilterChip
              key={keyword.label}
              label={keyword.label}
              count={keyword.count}
              active={active === keyword.label}
              onToggle={() => onToggle(keyword.label)}
            />
          )
          if (!onFollow) return chip
          return (
            <span key={keyword.label} className="inline-flex items-center gap-1">
              {chip}
              <FollowToggle
                kind="topic"
                value={keyword.label}
                followed={follows?.some((follow) => follow.kind === 'topic' && follow.value === keyword.label) ?? false}
                onToggle={(kind, value, next) => onFollow(kind, value, next)}
              />
            </span>
          )
        })}
      </div>
    </div>
  )
}

interface FeedListProps {
  items: ReportItem[]
  saved: Map<string, LibraryEntry>
  signedIn: boolean
  active: string | null
  onKeyword: (label: string) => void
  onToggle: (itemId: string, field: 'read_later' | 'important') => void
  /** When provided (the Feed page), topic chips carry follow stars. */
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, label: string, next: boolean) => void
}

export function FeedList({ items, saved, signedIn, active, onKeyword, onToggle, follows, onFollow }: FeedListProps) {
  return (
    <div>
      {items.map((item, index) => {
        const state = saved.get(item.id)
        const topics = topicsFor(item)
        return (
          <ReportItemRow
            key={item.id}
            item={item}
            rank={index + 1}
            tags={topics.length > 0 ? topics.map((label) => (
              onFollow ? (
                <span key={label} className="inline-flex items-center gap-1">
                  <FilterChip label={label} active={active === label} onToggle={() => onKeyword(label)} />
                  <FollowToggle
                    kind="topic"
                    value={label}
                    followed={follows?.some((follow) => follow.kind === 'topic' && follow.value === label) ?? false}
                    onToggle={(kind, value, next) => onFollow(kind, value, next)}
                  />
                </span>
              ) : (
                <FilterChip key={label} label={label} active={active === label} onToggle={() => onKeyword(label)} />
              )
            )) : undefined}
            followControl={onFollow ? (
              <FollowToggle
                kind="source"
                value={item.source}
                followed={follows?.some((follow) => follow.kind === 'source' && sameSource(follow.value, item.source)) ?? false}
                onToggle={(kind, value, next) => onFollow(kind, value, next)}
              />
            ) : undefined}
            actions={signedIn ? (
              <PaperActions
                readLater={state?.read_later === 1}
                important={state?.important === 1}
                onToggle={(field) => onToggle(item.id, field)}
              />
            ) : undefined}
          />
        )
      })}
    </div>
  )
}
