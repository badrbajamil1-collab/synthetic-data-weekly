import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { addMyNote, deleteMyNote, errorText, fetchMyNotes, type UserNote } from '@/lib/api'
import { formatDate } from '@/lib/report'

/**
 * Upcoming notes (spec "Library → Upcoming"): free-text entries for things the
 * reader wants to track that are not in a brief yet. Self-contained: fetches,
 * adds and deletes its own `user_notes` rows through /api/my/notes.
 */
export function NotesPanel() {
  const [notes, setNotes] = useState<UserNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setNotes(await fetchMyNotes())
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    setError(null)
    try {
      const created = await addMyNote(text)
      setNotes((current) => [created, ...current])
      setDraft('')
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      setNotes(await deleteMyNote(id))
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="upcoming-note" className="text-xs font-semibold text-muted-foreground">
          Track something not in a brief yet
        </label>
        <textarea
          id="upcoming-note"
          name="upcoming-note"
          rows={2}
          maxLength={2000}
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
          }}
          placeholder="A paper someone mentioned, a tool release to check next week…"
          className="mt-1.5 w-full resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm leading-6 text-ink placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Private to you. ⌘/Ctrl + Enter saves.</span>
          <Button variant="ink" size="sm" onClick={() => void submit()} disabled={!draft.trim() || saving}>
            Add note
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading your notes…</p>
      ) : notes.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing tracked yet. Note a talk, a demo or a dataset you want to follow up on.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-white px-4 py-3">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{note.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDate(note.created_at, 'short')}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Delete this note"
                onClick={() => void remove(note.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!loading && error && notes.length === 0 && (
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  )
}
