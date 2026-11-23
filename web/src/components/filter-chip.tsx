import { Star, X } from 'lucide-react'

import { describeChipState } from '@/lib/topics'
import { cn } from '@/lib/utils'

export interface FilterChipProps {
  label: string
  count?: number
  active: boolean
  removable?: boolean
  onToggle: () => void
  followed?: boolean
  onFollowToggle?: (next: boolean) => void
}

export function FilterChip({
  label,
  count,
  active,
  removable = true,
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
          state.tone === 'both' && 'border-primary/50 bg-[#e1f0ee]',
          state.tone === 'active' && 'border-primary/50 bg-[#e1f0ee]',
          state.tone === 'followed' && 'border-[#e5bc84] bg-[#fdf3e2]/80',
          state.tone === 'idle' && 'border-input bg-[#fffdf9] hover:border-primary',
        )}
      >
        <button
          type="button"
          aria-pressed={state.filterAriaPressed}
          onClick={onToggle}
          title={active ? `Remove "${label}" filter` : `Filter by ${label}`}
          className={cn(
            'touch-target relative inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-l-full py-1.5 pl-3 pr-2.5 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active
              ? 'font-semibold text-primary'
              : 'text-ink hover:text-primary',
          )}
        >
          <span>{label}</span>
          {count !== undefined && (
            <span
              className={cn(
                'rounded-full px-1.5 py-px font-mono text-[11px] tabular-nums',
                active
                  ? 'bg-primary font-semibold text-[#faf4ec]'
                  : 'bg-secondary text-muted-foreground',
              )}
            >
              {count}
            </span>
          )}
          {active && removable && <X className="size-3 text-primary" aria-hidden="true" />}
        </button>

        <button
          type="button"
          aria-pressed={state.followAriaPressed}
          aria-label={`Follow ${label} in your feed`}
          title={followed ? `Following ${label} (click to unfollow)` : `Follow ${label} in your feed`}
          onClick={(event) => {
            event.stopPropagation()
            onFollowToggle(!followed)
          }}
          className={cn(
            'touch-target relative inline-flex min-h-8 min-w-8 cursor-pointer items-center justify-center rounded-r-full border-l px-2.5 transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active ? 'border-primary/20' : followed ? 'border-[#e5bc84]' : 'border-border',
            followed
              ? 'text-[#b46319] hover:text-[#965011]'
              : 'text-muted-foreground hover:text-[#b46319]',
          )}
        >
          <Star
            className={cn('size-3.5 transition-transform', followed && 'fill-current')}
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
        'touch-target inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary font-semibold text-[#faf4ec]'
          : 'border-input bg-[#fffdf9] text-ink hover:border-primary hover:text-primary',
      )}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'font-mono text-[11px] tabular-nums',
            active ? 'font-semibold text-[#faf4ec]/90' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
      {active && removable && <X className="size-3 text-[#faf4ec]" aria-hidden="true" />}
    </button>
  )
}
