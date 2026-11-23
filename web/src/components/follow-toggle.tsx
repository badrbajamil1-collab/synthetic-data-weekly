import { Star } from 'lucide-react'

import { sourceLabel } from '@/lib/report'
import type { TopicKind } from '@/lib/topics'
import { cn } from '@/lib/utils'

interface FollowToggleProps {
  kind: TopicKind
  value: string
  followed: boolean
  onToggle: (kind: TopicKind, value: string, next: boolean) => void | Promise<void>
}

/**
 * The followable star on source badges: filled when followed, outline when not.
 */
export function FollowToggle({ kind, value, followed, onToggle }: FollowToggleProps) {
  const display = kind === 'source' ? sourceLabel(value) : value
  return (
    <button
      type="button"
      aria-pressed={followed}
      aria-label={`Follow ${display} in your feed`}
      title={followed ? `Following ${display} (click to unfollow)` : `Follow ${display} in your feed`}
      onClick={(event) => {
        event.stopPropagation()
        void onToggle(kind, value, !followed)
      }}
      className={cn(
        'touch-target grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:active:scale-95',
        followed
          ? 'border-[#e5bc84] bg-[#fdf3e2] text-[#b46319] hover:bg-[#fae8cc]'
          : 'border-transparent text-muted-foreground hover:border-border hover:bg-secondary hover:text-[#b46319]',
      )}
    >
      <Star className={cn('size-3.5 transition-transform', followed && 'fill-current')} aria-hidden="true" />
    </button>
  )
}
