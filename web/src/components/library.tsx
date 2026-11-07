import { useEffect, useState } from 'react'
import { ArrowUpRight, BookmarkCheck, Star } from 'lucide-react'

import { NotesPanel } from '@/components/notes-panel'
import { PaperActions } from '@/components/paper-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate, sourceLabel } from '@/lib/report'
import type { LibraryEntry } from '@/lib/api'

interface LibraryProps {
  entries: LibraryEntry[]
  onToggle: (itemId: string, field: 'read_later' | 'important') => void
  onNote: (itemId: string, note: string) => void
  loading: boolean
  error: string | null
  reload?: () => void
}

function NoteEditor({ itemId, note, onSave }: { itemId: string; note: string; onSave: (id: string, note: string) => void }) {
  const [draft, setDraft] = useState(note)
  useEffect(() => setDraft(note), [note])
  return (
    <div className="mt-4">
      <label htmlFor={`note-${itemId}`} className="text-xs font-semibold text-muted-foreground">
        Your note
      </label>
      <textarea
        id={`note-${itemId}`}
        name="note"
        value={draft}
        maxLength={2000}
        rows={2}
        autoComplete="off"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== note && onSave(itemId, draft)}
        placeholder="Why it matters to you, what to check next…"
        className="mt-1.5 w-full resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm leading-6 text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}

function Entry({ entry, onToggle, onNote }: { entry: LibraryEntry; onToggle: LibraryProps['onToggle']; onNote: LibraryProps['onNote'] }) {
  return (
    <article className="border-t border-border py-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{sourceLabel(entry.source)}</Badge>
        <span>Week ending {formatDate(entry.week_end, 'long')}</span>
        {entry.important === 1 && <span className="inline-flex items-center gap-1 text-primary"><Star className="size-3.5 fill-current" aria-hidden="true" />Important</span>}
        {entry.read_later === 1 && <span className="inline-flex items-center gap-1 text-primary"><BookmarkCheck className="size-3.5" aria-hidden="true" />Read later</span>}
      </div>
      <h3 className="mt-2 break-words text-balance font-display text-xl font-medium leading-snug text-ink">
        <a href={entry.url} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {entry.title}
          <ArrowUpRight className="mb-1 ml-1 inline size-4" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </h3>
      {entry.summary && <p className="mt-2 max-w-3xl text-[15px] leading-7 text-muted-foreground">{entry.summary}</p>}
      <div className="mt-4">
        <PaperActions
          readLater={entry.read_later === 1}
          important={entry.important === 1}
          onToggle={(field) => onToggle(entry.id, field)}
        />
      </div>
      <NoteEditor itemId={entry.id} note={entry.note} onSave={onNote} />
    </article>
  )
}

export function Library({ entries, onToggle, onNote, loading, error, reload }: LibraryProps) {
  const readLater = entries.filter((e) => e.read_later === 1)
  const important = entries.filter((e) => e.important === 1)

  const notes = entries.filter((e) => e.note.trim() !== '')

  // One page-level alert above a surviving list: a failed save or reload must
  // not erase the library (spec: failed API call → error with a retry button).
  if (loading) {
    return (
      <div>
        {error && (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
            <span>{error}</span>
            {reload && (
              <Button className="ml-auto" variant="outline" size="sm" onClick={reload}>Try again</Button>
            )}
          </div>
        )}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading your library…</p>
      </div>
    )
  }

  if (entries.length === 0 && !error) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-white/70 px-6 py-14 text-center">
        <p className="font-display text-2xl">Nothing saved yet.</p>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          Use Read later or Mark important on any paper and it will appear here, private to you.
        </p>
        <div className="mt-10 max-w-xl text-left">
          <p className="mb-4 text-center text-sm font-semibold text-muted-foreground">Upcoming already lives here:</p>
          <NotesPanel />
        </div>
      </div>
    )
  }

  const lists = [
    { value: 'all', label: 'All saved', items: entries },
    { value: 'later', label: 'Read later', items: readLater },
    { value: 'important', label: 'Important', items: important },
    { value: 'notes', label: 'Notes', items: notes },
  ]

  return (
    <div>
      {error && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive" role="alert">
          <span>{error}</span>
          {reload && (
            <Button className="ml-auto" variant="outline" size="sm" onClick={reload}>Try again</Button>
          )}
        </div>
      )}
      <Tabs defaultValue="all">
      <TabsList className="max-w-full overflow-x-auto overscroll-contain">
        {lists.map((list) => (
          <TabsTrigger key={list.value} value={list.value}>
            {list.label}
            <span className="ml-1.5 rounded-full bg-black/6 px-1.5 py-0.5 text-[11px] leading-none">{list.items.length}</span>
          </TabsTrigger>
        ))}
        <TabsTrigger value="upcoming">
          Upcoming
        </TabsTrigger>
      </TabsList>
      {lists.map((list) => (
        <TabsContent key={list.value} value={list.value}>
          {list.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing in this list yet.</p>
          ) : (
            list.items.map((entry) => <Entry key={entry.id} entry={entry} onToggle={onToggle} onNote={onNote} />)
          )}
        </TabsContent>
      ))}
      <TabsContent value="upcoming">
        <NotesPanel />
      </TabsContent>
      </Tabs>
    </div>
  )
}
