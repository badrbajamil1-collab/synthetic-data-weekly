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
          ? 'border-amber-400/70 bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'border-transparent text-slate-600 hover:border-border hover:bg-background hover:text-amber-700',
      )}
    >
      <Star className={cn('size-3.5 transition-transform', followed && 'fill-current')} aria-hidden="true" />
    </button>
  )
}
