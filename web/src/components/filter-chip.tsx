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
          'inline-flex items-stretch rounded-full border text-xs font-semibold transition-all shadow-2xs',
          state.tone === 'both' && 'border-primary bg-primary/10 ring-1 ring-primary/25',
          state.tone === 'active' && 'border-primary bg-primary/10 ring-1 ring-primary/25',
          state.tone === 'followed' && 'border-amber-400/70 bg-amber-50/60',
          state.tone === 'idle' && 'border-border bg-white hover:border-primary/35',
        )}
      >
        <button
          type="button"
          aria-pressed={state.filterAriaPressed}
          onClick={onToggle}
          title={active ? `Remove "${label}" filter` : `Filter by ${label}`}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-l-full py-1.5 pl-3 pr-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? 'text-primary font-semibold'
              : 'text-ink/85 hover:text-primary',
          )}
        >
          <span>{label}</span>
          {count !== undefined && (
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums',
                active ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground',
              )}
            >
              {count}
            </span>
          )}
          {active && <X className="size-3 text-primary/80" aria-hidden="true" />}
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
            'inline-flex cursor-pointer items-center justify-center rounded-r-full border-l px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95',
            active ? 'border-primary/20' : followed ? 'border-amber-300/70' : 'border-border/80',
            followed
              ? 'bg-amber-100/80 text-amber-600 hover:bg-amber-200/70'
              : 'text-muted-foreground/70 hover:bg-amber-50 hover:text-amber-600',
          )}
        >
          <Star
            className={cn('size-3.5 transition-transform', followed && 'scale-110 fill-current')}
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
        'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
        active
          ? 'border-primary bg-primary/12 text-primary shadow-2xs ring-1 ring-primary/25'
          : 'border-border bg-white text-ink/85 hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 py-px text-[11px] leading-4 tabular-nums',
            active ? 'bg-primary text-white' : 'bg-secondary text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
      {active && <X className="size-3 text-primary/80" aria-hidden="true" />}
    </button>
  )
}
