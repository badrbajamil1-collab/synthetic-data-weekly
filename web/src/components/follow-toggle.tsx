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
      onClick={() => void onToggle(kind, value, !followed)}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        followed ? 'text-primary hover:text-primary/80' : 'text-muted-foreground/60 hover:text-primary',
      )}
    >
      <Star className={cn('size-3.5', followed && 'fill-current')} aria-hidden="true" />
    </button>
  )
}
