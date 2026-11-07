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
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-ink bg-ink text-white'
          : 'border-border bg-white text-ink/80 hover:border-primary/40 hover:text-primary',
      )}
    >
      {label}
      {count !== undefined && (
        <span
          className={cn(
            'rounded-full px-1.5 py-px text-[11px] leading-4',
            active ? 'bg-white/20' : 'bg-secondary text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}
