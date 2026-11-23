import { useId, useState } from 'react'
import { Search } from 'lucide-react'

import { FilterChip } from '@/components/filter-chip'
import { FollowToggle } from '@/components/follow-toggle'
import { Link } from '@/components/link'
import { PaperActions } from '@/components/paper-actions'
import { ReportItemRow } from '@/components/report-item'
import { Button } from '@/components/ui/button'
import type { LibraryEntry, SavableItemMeta } from '@/lib/api'
import { topicsFor, type FeedSection, type FeedView } from '@/lib/feed'
import { formatDate, type Report, type ReportItem } from '@/lib/report'
import { sameFollow, type TopicFollow, type TopicKind } from '@/lib/topics'
import { cn } from '@/lib/utils'

const VIEW_LABELS: Record<FeedView, string> = {
  all: 'All in feed',
  read_later: 'Read later',
  important: 'Important',
}

const SECTION_OPTIONS: Array<{ value: FeedSection; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'top', label: 'Top picks' },
  { value: 'tool', label: 'Tools' },
  { value: 'worth', label: 'Worth a look' },
]

const MAX_SIDEBAR_WEEKS = 6

export type BriefSortOrder = 'ranked' | 'newest'

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
    <aside aria-label="Feed filters and weeks" className="lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-2xl border border-border bg-[#fffdf9] p-5 shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-primary">Saved filter</h2>

        <div role="group" aria-label="Filter by saved status" className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(VIEW_LABELS) as FeedView[]).map((key) => {
            const active = view === key
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => onView(key)}
                className={cn(
                  'touch-target inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-primary bg-primary text-[#faf4ec]'
                    : 'border-input bg-[#fffdf9] text-ink hover:border-primary hover:text-primary',
                )}
              >
                <span>{VIEW_LABELS[key]}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px font-mono text-[11px] leading-4 tabular-nums',
                    active ? 'bg-[#fffdf9]/20 text-[#faf4ec]' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {viewCounts[key]}
                </span>
              </button>
            )
          })}
        </div>

        <h3 className="mt-7 text-xs font-bold text-muted-foreground">Weeks</h3>
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {reports.slice(0, MAX_SIDEBAR_WEEKS).map((report) => {
            const active = report.id === selectedId
            return (
              <li key={report.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelectWeek(report.id)}
                  className={cn(
                    'touch-target inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active
                      ? 'border-primary bg-primary font-semibold text-[#faf4ec]'
                      : 'border-input bg-[#fffdf9] text-ink hover:border-primary hover:text-primary',
                  )}
                >
                  Week of {formatDate(report.week_end, 'short')}
                </button>
              </li>
            )
          })}
        </ul>

        {reports.length > MAX_SIDEBAR_WEEKS && (
          <Link
            to="/archive"
            className="mt-4 inline-block rounded-sm text-xs font-bold text-[#b46319] underline-offset-4 hover:text-[#965011] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            All {reports.length} weeks in the archive
          </Link>
        )}
      </div>
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
  sortOrder?: BriefSortOrder
  onSortOrder?: (sort: BriefSortOrder) => void
}

export function FeedFilterBar({
  query,
  onQuery,
  section,
  onSection,
  sectionCounts,
  activeFilters,
  onClear,
  sortOrder,
  onSortOrder,
}: FeedFilterBarProps) {
  const searchId = useId()

  return (
    <search className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative flex-1 lg:max-w-md">
        <label htmlFor={searchId} className="sr-only">
          Filter items in this brief
        </label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id={searchId}
          type="search"
          name="q"
          value={query}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Filter this brief (privacy, tabular)…"
          className="h-11 w-full rounded-xl border border-input bg-[#fffdf9] pl-10 pr-4 text-sm text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by section" className="flex flex-wrap gap-1.5">
          {SECTION_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              label={option.label}
              count={sectionCounts[option.value]}
              active={section === option.value}
              removable={option.value !== 'all'}
              onToggle={() => onSection(section === option.value && option.value !== 'all' ? 'all' : option.value)}
            />
          ))}
        </div>

        {sortOrder && onSortOrder && (
          <div
            role="group"
            aria-label="Sort order"
            className="inline-flex items-center rounded-full border border-input bg-[#fffdf9] p-0.5 text-xs"
          >
            {(
              [
                { value: 'ranked' as const, label: 'Ranked' },
                { value: 'newest' as const, label: 'Newest' },
              ]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={sortOrder === opt.value}
                onClick={() => onSortOrder(opt.value)}
                className={cn(
                  'touch-target min-h-8 cursor-pointer rounded-full px-3 py-1 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  sortOrder === opt.value
                    ? 'bg-primary text-[#faf4ec]'
                    : 'text-muted-foreground hover:text-primary',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear ({activeFilters})
          </Button>
        )}
      </div>
    </search>
  )
}

interface KeywordStripProps {
  counts: Array<{ label: string; count: number }>
  active: string | null
  onToggle: (label: string) => void
  /** When provided, every chip has an integrated star follow segment. */
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, label: string, next: boolean) => void
}

const INITIAL_TOPIC_CHIPS = 6

export function KeywordStrip({ counts, active, onToggle, follows, onFollow }: KeywordStripProps) {
  const [showAll, setShowAll] = useState(false)
  if (counts.length === 0) return null

  const baseVisible = showAll ? counts : counts.slice(0, INITIAL_TOPIC_CHIPS)
  const visibleCounts =
    !showAll && active && !baseVisible.some((c) => c.label === active)
      ? [...baseVisible, ...counts.filter((c) => c.label === active)]
      : baseVisible
  const hiddenCount = Math.max(0, counts.length - visibleCounts.length)
  const canToggleMore = showAll ? counts.length > INITIAL_TOPIC_CHIPS : hiddenCount > 0

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">
          Topics this week{onFollow ? ' — select a topic to filter, star to follow' : ' — select a topic to filter'}
        </p>
        {active && (
          <button
            type="button"
            onClick={() => onToggle(active)}
            className="touch-target inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 text-xs font-bold text-[#b46319] hover:text-[#965011] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear &ldquo;{active}&rdquo; filter
          </button>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {visibleCounts.map((keyword) => (
          <FilterChip
            key={keyword.label}
            label={keyword.label}
            count={keyword.count}
            active={active === keyword.label}
            onToggle={() => onToggle(keyword.label)}
            followed={follows?.some((follow) => sameFollow(follow, 'topic', keyword.label)) ?? false}
            onFollowToggle={
              onFollow
                ? (next) => onFollow('topic', keyword.label, next)
                : undefined
            }
          />
        ))}
        {canToggleMore && (
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((prev) => !prev)}
            className="touch-target inline-flex min-h-8 cursor-pointer items-center rounded-full border border-dashed border-input bg-transparent px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showAll
              ? 'Show fewer topics'
              : `+${hiddenCount} more ${hiddenCount === 1 ? 'topic' : 'topics'}`}
          </button>
        )}
      </div>
    </div>
  )
}

interface FeedListProps {
  items: ReportItem[]
  weekEnd?: string
  headingLevel?: 'h2' | 'h3'
  saved: Map<string, LibraryEntry>
  signedIn: boolean
  active: string | null
  onKeyword: (label: string) => void
  onToggle: (itemId: string, field: 'read_later' | 'important', itemMeta?: SavableItemMeta) => void
  /** When provided, topic chips carry follow stars. */
  follows?: TopicFollow[]
  onFollow?: (kind: TopicKind, label: string, next: boolean) => void
  initialExpandedId?: string | null
  onInspect?: (itemId: string) => void
}

export function FeedList({
  items,
  weekEnd,
  headingLevel = 'h3',
  saved,
  signedIn,
  active,
  onKeyword,
  onToggle,
  follows,
  onFollow,
  initialExpandedId,
  onInspect,
}: FeedListProps) {
  return (
    <div className="space-y-3.5">
      {items.map((item, index) => {
        const state = saved.get(item.id)
        const topics = topicsFor(item)
        const isDefaultExpanded = initialExpandedId === item.id
        return (
          <ReportItemRow
            key={`${item.id}:${isDefaultExpanded ? 'open' : 'closed'}`}
            item={item}
            rank={index + 1}
            headingLevel={headingLevel}
            defaultExpanded={isDefaultExpanded}
            highlighted={isDefaultExpanded}
            onInspect={onInspect}
            tags={topics.length > 0 ? topics.map((label) => (
              <FilterChip
                key={label}
                label={label}
                active={active === label}
                onToggle={() => onKeyword(label)}
                followed={follows?.some((follow) => sameFollow(follow, 'topic', label)) ?? false}
                onFollowToggle={
                  onFollow
                    ? (next) => onFollow('topic', label, next)
                    : undefined
                }
              />
            )) : undefined}
            followControl={onFollow ? (
              <FollowToggle
                kind="source"
                value={item.source}
                followed={follows?.some((follow) => sameFollow(follow, 'source', item.source)) ?? false}
                onToggle={(kind, value, next) => onFollow(kind, value, next)}
              />
            ) : undefined}
            actions={signedIn ? (
              <PaperActions
                readLater={state?.read_later === 1}
                important={state?.important === 1}
                onToggle={(field) => onToggle(item.id, field, { ...item, week_end: weekEnd })}
              />
            ) : undefined}
          />
        )
      })}
    </div>
  )
}
