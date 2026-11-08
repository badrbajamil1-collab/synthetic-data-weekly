import { Star, X } from 'lucide-react'

import { describeChipState } from '@/lib/topics'
import { cn } from '@/lib/utils'

export interface FilterChipProps {
  label: string
  count?: number
  active: boolean
  onToggle: () => void
  followed?: boolean
  onFollowToggle?: (next: boolean) => void
}

export function FilterChip({
  label,
  count,
  active,
  onToggle,
  followed = false,
  onFollowToggle,
}: FilterChipProps) {
  const state = describeChipState({ active, followed })

  if (onFollowToggle) {
    return (
      <span
        className={cn(
          'inline-flex items-stretch rounded-full border text-xs font-medium transition-colors',
          state.tone === 'both' && 'border-primary/45 bg-primary/10',
          state.tone === 'active' && 'border-primary/45 bg-primary/10',
          state.tone === 'followed' && 'border-amber-300/75 bg-amber-50/40',
          state.tone === 'idle' && 'border-border/75 bg-white hover:border-primary/30',
        )}
      >
        <button
          type="button"
          aria-pressed={state.filterAriaPressed}
          onClick={onToggle}
          title={active ? `Remove "${label}" filter` : `Filter by ${label}`}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-l-full py-1 pl-3 pr-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? 'text-primary font-semibold'
              : 'text-ink/80 hover:text-primary',
          )}
        >
          <span>{label}</span>
          {count !== undefined && (
            <span
              className={cn(
                'text-[11px] tabular-nums',
                active ? 'font-semibold text-primary' : 'text-muted-foreground',
              )}
            >
              {count}
            </span>
          )}
          {active && <X className="size-3 text-primary/75" aria-hidden="true" />}
        </button>

        <button
          type="button"
          aria-pressed={state.followAriaPressed}
          aria-label={followed ? `Stop following ${label}` : `Follow ${label} in your feed`}
          title={followed ? `Following ${label} (click to unfollow)` : `Follow ${label} in your feed`}
          onClick={(event) => {
            event.stopPropagation()
            onFollowToggle(!followed)
          }}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center rounded-r-full border-l px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active ? 'border-primary/20' : followed ? 'border-amber-200/80' : 'border-border/60',
            followed
              ? 'text-amber-600 hover:text-amber-700'
              : 'text-muted-foreground/55 hover:text-amber-600',
          )}
        >
          <Star
            className={cn('size-3 transition-transform', followed && 'fill-current')}
            aria-hidden="true"
          />
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary/45 bg-primary/10 font-semibold text-primary'
          : 'border-border/75 bg-white text-ink/80 hover:border-primary/30 hover:text-primary',
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'text-[11px] tabular-nums',
            active ? 'font-semibold text-primary' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
      {active && <X className="size-3 text-primary/75" aria-hidden="true" />}
    </button>
  )
}
