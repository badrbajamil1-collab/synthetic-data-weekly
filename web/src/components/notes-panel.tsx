import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { addMyNote, deleteMyNote, errorText, fetchMyNotes, type UserNote } from '@/lib/api'
import { formatDate } from '@/lib/report'

/**
 * Upcoming notes: free-text entries for things the reader wants to track
 * that are not in a brief yet. Self-contained against /api/my/notes.
 */
export function NotesPanel() {
  const [notes, setNotes] = useState<UserNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const fetched = await fetchMyNotes()
        if (active) {
          setNotes(fetched)
          setError(null)
        }
      } catch (caught) {
        if (active) setError(errorText(caught))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [retryTick])

  function handleRetry() {
    setLoading(true)
    setError(null)
    setRetryTick((tick) => tick + 1)
  }

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
    if (deletingId) return
    setDeletingId(id)
    setError(null)
    try {
      setNotes(await deleteMyNote(id))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setDeletingId(null)
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
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          placeholder="A paper someone mentioned, a tool release to check next week…"
          className="mt-1.5 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 text-ink placeholder:text-muted-foreground focus-visible:bg-[#fffdf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">Private to you. ⌘/Ctrl + Enter saves.</span>
          <Button variant="default" size="sm" onClick={() => void submit()} disabled={!draft.trim() || saving}>
            {saving ? 'Adding…' : 'Add note'}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/25 bg-[#fff5f7] p-4 text-sm text-destructive">
          <span>{error}</span>
          {notes.length === 0 && !loading && (
            <Button className="ml-auto" variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading your notes…</p>
      ) : notes.length === 0 && !error ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing tracked yet. Note a talk, a demo or a dataset you want to follow up on.
        </p>
      ) : notes.length > 0 ? (
        <ul className="space-y-3">
          {notes.map((note) => {
            const snippet = note.body.length > 36 ? `${note.body.slice(0, 36)}…` : note.body
            const isDeleting = deletingId === note.id
            return (
              <li key={note.id} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-background px-4 py-3">
                <div className="min-w-0">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{note.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(note.created_at, 'short')}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete note: ${snippet}`}
                  disabled={isDeleting}
                  onClick={() => void remove(note.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
