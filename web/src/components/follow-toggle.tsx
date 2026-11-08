import { Star } from 'lucide-react'

import type { TopicKind } from '@/lib/topics'
import { cn } from '@/lib/utils'

interface FollowToggleProps {
  kind: TopicKind
  value: string
  followed: boolean
  onToggle: (kind: TopicKind, value: string, next: boolean) => void | Promise<void>
}

/**
 * The followable star on topic chips and source badges (spec "Following topics
 * and sources"): filled when followed, outline when not.
 */
export function FollowToggle({ kind, value, followed, onToggle }: FollowToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={followed}
      aria-label={followed ? `Stop following ${value}` : `Follow ${value} in your feed`}
      title={followed ? 'Stop following' : 'Follow in your feed'}
      onClick={(event) => {
        event.stopPropagation()
        void onToggle(kind, value, !followed)
      }}
      className={cn(
        'grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90',
        followed
          ? 'border-amber-400/60 bg-amber-50 text-amber-600 shadow-2xs hover:bg-amber-100'
          : 'border-transparent text-muted-foreground/70 hover:border-border hover:bg-white hover:text-amber-600',
      )}
    >
      <Star className={cn('size-3.5 transition-transform', followed && 'scale-110 fill-current')} aria-hidden="true" />
    </button>
  )
}
