import { useState } from 'react'
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react'

interface EditorialTakeawayProps {
  text: string
  label?: string
}

/**
 * Splits a multi-sentence trend/summary paragraph into a 1-sentence lead
 * plus scannable bullet points behind a compact expand/collapse toggle,
 * eliminating the giant serif wall of text.
 */
export function splitTrendSentences(raw: string): string[] {
  return raw
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function EditorialTakeaway({
  text,
  label = 'Weekly takeaway',
}: EditorialTakeawayProps) {
  const [expanded, setExpanded] = useState(false)
  const sentences = splitTrendSentences(text)
  if (sentences.length === 0) return null

  const lead = sentences[0]
  const bullets = sentences.slice(1)

  return (
    <div className="mt-6 rounded-2xl border border-border/80 bg-white px-5 py-4 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="size-3.5" aria-hidden="true" />
          {label}
        </span>

        {bullets.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/80 bg-secondary/50 px-2.5 py-1 text-xs font-medium text-ink/80 transition-colors hover:border-primary/40 hover:text-primary"
          >
            {expanded ? (
              <>
                Show less
                <ChevronUp className="size-3.5" aria-hidden="true" />
              </>
            ) : (
              <>
                {bullets.length} more key {bullets.length === 1 ? 'point' : 'points'}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </>
            )}
          </button>
        )}
      </div>

      <p className="mt-2 text-sm font-medium leading-6 text-ink sm:text-[15px]">
        {lead}
      </p>

      {expanded && bullets.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-border/60 pt-3">
          {bullets.map((point, index) => (
            <li
              key={index}
              className="flex items-start gap-2.5 text-sm leading-6 text-ink/80"
            >
              <span
                className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                aria-hidden="true"
              />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
