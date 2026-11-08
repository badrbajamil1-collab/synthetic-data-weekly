import { cn } from '@/lib/utils'

interface FilterChipProps {
  label: string
  count?: number
  active: boolean
  onToggle: () => void
}

export function FilterChip({ label, count, active, onToggle }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]',
        active
          ? 'border-primary bg-primary/12 text-primary shadow-2xs ring-1 ring-primary/25'
          : 'border-border bg-white text-ink/80 hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
      )}
    >
      {label}
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
    </button>
  )
}
