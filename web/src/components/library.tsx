import { useState } from 'react'
import { ArrowUpRight, BookmarkCheck, Check, Star } from 'lucide-react'

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
  onNote: (itemId: string, note: string) => Promise<void> | void
  loading: boolean
  error: string | null
  reload?: () => void
}

function NoteEditor({
  itemId,
  note,
  onSave,
}: {
  itemId: string
  note: string
  onSave: (id: string, note: string) => Promise<void> | void
}) {
  const [draft, setDraft] = useState(note)
  const [syncedNote, setSyncedNote] = useState(note)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  if (syncedNote !== note) {
    setSyncedNote(note)
    setDraft(note)
  }

  const dirty = draft !== note

  async function commit() {
    if (!dirty || saving) return
    setSaving(true)
    setJustSaved(false)
    try {
      await onSave(itemId, draft)
      setJustSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`note-${itemId}`} className="text-xs font-semibold text-muted-foreground">
          Your note
        </label>
        <div className="flex items-center gap-2">
          {justSaved && !dirty && (
            <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-primary">
              <Check className="size-3.5" aria-hidden="true" />
              Saved
            </span>
          )}
          {dirty && (
            <Button type="button" variant="outline" size="sm" onClick={() => void commit()} disabled={saving}>
              {saving ? 'Saving…' : 'Save note'}
            </Button>
          )}
        </div>
      </div>
      <textarea
        id={`note-${itemId}`}
        name="note"
        value={draft}
        maxLength={2000}
        rows={2}
        autoComplete="off"
        onChange={(event) => {
          setDraft(event.target.value)
          if (justSaved) setJustSaved(false)
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void commit()
          }
        }}
        placeholder="Why it matters to you, what to check next…"
        className="mt-1.5 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 text-ink placeholder:text-muted-foreground focus-visible:bg-[#fffdf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  )
}

function Entry({ entry, onToggle, onNote }: { entry: LibraryEntry; onToggle: LibraryProps['onToggle']; onNote: LibraryProps['onNote'] }) {
  return (
    <article className="mb-4 rounded-2xl border border-border bg-[#fffdf9] p-5 shadow-[0_6px_18px_rgba(14,62,64,0.05)] last:mb-0 sm:p-6">
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <Badge variant="secondary">{sourceLabel(entry.source)}</Badge>
        <span>Week ending {formatDate(entry.week_end, 'long')}</span>
        {entry.important === 1 && (
          <span className="inline-flex items-center gap-1 font-semibold text-[#b46319]">
            <Star className="size-3.5 fill-current" aria-hidden="true" />
            Important
          </span>
        )}
        {entry.read_later === 1 && (
          <span className="inline-flex items-center gap-1 font-semibold text-primary">
            <BookmarkCheck className="size-3.5" aria-hidden="true" />
            Read later
          </span>
        )}
      </div>
      <h2 className="mt-2.5 break-words text-balance font-display text-xl font-semibold leading-snug text-primary">
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm decoration-[#b46319]/60 underline-offset-4 hover:text-[#b46319] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {entry.title}
          <ArrowUpRight className="mb-1 ml-1 inline size-4" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </h2>
      {entry.summary && <p className="mt-2 max-w-[72ch] text-[15px] leading-7 text-ink/85">{entry.summary}</p>}
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
  const [activeTab, setActiveTab] = useState('all')
  const readLater = entries.filter((e) => e.read_later === 1)
  const important = entries.filter((e) => e.important === 1)
  const notes = entries.filter((e) => e.note.trim() !== '')

  // Only show full loading state on initial empty load; keep Tabs mounted on
  // background syncs so saving a note or toggling Read later never resets tabs or scroll.
  if (loading && entries.length === 0) {
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
      <div className="rounded-3xl border border-dashed border-input bg-[#fffdf9]/90 px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)]">
        <h2 className="font-display text-2xl font-medium text-primary">Nothing saved yet.</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Use Read later or Mark important on any paper and it will appear here, private to you.
        </p>
        <div className="mx-auto mt-10 max-w-xl text-left">
          <p className="mb-4 text-center text-sm font-semibold text-muted-foreground">Track upcoming leads here:</p>
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
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="max-w-full overflow-x-auto overscroll-contain">
          {lists.map((list) => (
            <TabsTrigger key={list.value} value={list.value}>
              {list.label}
              <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted-foreground tabular-nums group-data-[state=active]:bg-white/20 group-data-[state=active]:text-[#faf4ec]">
                {list.items.length}
              </span>
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
          <div className="rounded-2xl border border-border bg-[#fffdf9] p-5 shadow-[0_6px_18px_rgba(14,62,64,0.05)] sm:p-6">
            <NotesPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
