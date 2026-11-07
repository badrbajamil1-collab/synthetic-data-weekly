import { BookmarkPlus, BookmarkCheck, Star } from 'lucide-react'

import { Button } from '@/components/ui/button'

interface PaperActionsProps {
  readLater: boolean
  important: boolean
  onToggle: (field: 'read_later' | 'important') => void
  disabled?: boolean
}

export function PaperActions({ readLater, important, onToggle, disabled }: PaperActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant={readLater ? 'ink' : 'outline'}
        aria-pressed={readLater}
        disabled={disabled}
        onClick={() => onToggle('read_later')}
      >
        {readLater ? <BookmarkCheck aria-hidden="true" /> : <BookmarkPlus aria-hidden="true" />}
        {readLater ? 'Saved to read later' : 'Read later'}
      </Button>
      <Button
        size="sm"
        variant={important ? 'ink' : 'outline'}
        aria-pressed={important}
        disabled={disabled}
        onClick={() => onToggle('important')}
      >
        <Star className={important ? 'fill-current' : undefined} aria-hidden="true" />
        {important ? 'Marked important' : 'Mark important'}
      </Button>
    </div>
  )
}
