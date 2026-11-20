import { useId, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { splitTrendSentences } from '@/lib/report'

interface EditorialTakeawayProps {
  text: string
  label?: string
}

export function EditorialTakeaway({
  text,
  label = 'Weekly takeaway',
}: EditorialTakeawayProps) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const sentences = splitTrendSentences(text)
  if (sentences.length === 0) return null

  const lead = sentences[0]
  const bullets = sentences.slice(1)

  return (
    <div className="mt-6 rounded-2xl border border-border bg-white px-5 py-4 shadow-2xs sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-primary">
          <span className="h-3.5 w-0.5 rounded-full bg-primary" aria-hidden="true" />
          {label}
        </span>

        {bullets.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((prev) => !prev)}
            className="touch-target inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-ink transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? (
              <>
                Show less
                <ChevronUp className="size-3.5" aria-hidden="true" />
              </>
            ) : (
              <>
                {bullets.length} more {bullets.length === 1 ? 'note' : 'notes'}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </>
            )}
          </button>
        )}
      </div>

      <p className="mt-2 max-w-[74ch] text-sm font-medium leading-6 text-ink sm:text-[15px]">
        {lead}
      </p>

      {bullets.length > 0 && (
        <div
          id={panelId}
          data-expanded={expanded ? 'true' : 'false'}
          aria-hidden={!expanded}
          inert={!expanded}
          className="expandable-panel"
        >
          <ul className="mt-3 space-y-2 border-t border-border/70 pt-3">
            {bullets.map((point, index) => (
              <li
                key={index}
                className="flex max-w-[74ch] items-start gap-2.5 text-sm leading-6 text-ink/85"
              >
                <span
                  className="mt-2.5 size-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden="true"
                />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
