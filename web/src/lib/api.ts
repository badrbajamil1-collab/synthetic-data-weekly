import { type TopicFollow } from '@/lib/topics'

export interface Me {
  user_id: string
  email: string
  isAdmin: boolean
  /** Followed topics and sources; the feed filters on first paint. */
  topics?: TopicFollow[]
}

export interface PaperState {
  item_id: string
  read_later: boolean
  important: boolean
  note: string
  updated_at: string
}

export interface LibraryEntry {
  id: string
  title: string
  url: string
  source: string
  published: string
  score: number
  reason: string
  summary: string
  section: string
  week_end: string
  read_later: number
  important: number
  note: string
  updated_at: string
}

export async function getJson<T>(path: string): Promise<T | null> {
  const response = await fetch(path, { headers: { Accept: 'application/json', ...(await authHeaders()) } })
  if (response.status === 401) {
    throw new Error('Your session was not accepted. Sign in again to load this.')
  }
  if (!response.ok) throw new Error(`Request failed (${response.status}). Try again in a moment.`)
  return (await response.json()) as T
}

/**
 * Clerk hands out a short-lived session JWT; the SPA attaches it as a bearer
 * token and the Worker verifies it against the Clerk secret key. Set once from
 * App via setApiTokenGetter.
 */
let apiTokenGetter: (() => Promise<string | null>) | null = null

export function setApiTokenGetter(getter: () => Promise<string | null>): void {
  apiTokenGetter = getter
}

export async function authHeaders(): Promise<Record<string, string>> {
  if (!apiTokenGetter) return {}
  try {
    const token = await apiTokenGetter()
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function saveState(itemId: string, patch: Partial<Pick<PaperState, 'read_later' | 'important' | 'note'>>): Promise<PaperState> {
  const response = await fetch(`/api/my/items/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`Could not save (${response.status}). Try again in a moment.`)
  return (await response.json()) as PaperState
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again in a moment.'
}

export interface UserNote {
  id: string
  body: string
  created_at: string
}

/** The signed-in per-person state the App shell owns and every page consumes. */
export interface LibraryBundle {
  entries: LibraryEntry[]
  savedById: Map<string, LibraryEntry>
  loading: boolean
  error: string | null
  togglePaper: (itemId: string, field: 'read_later' | 'important') => Promise<void>
  saveNote: (itemId: string, note: string) => Promise<void>
  reload: () => void
}

/** Archive-wide topic and source counts behind the Feed page's **My topics** panel. */
export interface ArchiveCounts {
  topics: Array<{ label: string; count: number }>
  sources: Array<{ label: string; count: number }>
}

export async function fetchArchiveCounts(): Promise<ArchiveCounts | null> {
  try {
    const response = await fetch('/api/archive/counts', { headers: { Accept: 'application/json' } })
    if (!response.ok) return null
    return (await response.json()) as ArchiveCounts
  } catch {
    return null
  }
}

async function toggleFollow(method: 'PUT' | 'DELETE', follow: TopicFollow): Promise<TopicFollow[]> {
  const response = await fetch('/api/my/topics', {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(follow),
  })
  if (!response.ok) {
    throw new Error(`Could not update your follows (${response.status}). Try again in a moment.`)
  }
  return (await response.json() as { topics: TopicFollow[] }).topics
}

export function putTopic(follow: TopicFollow): Promise<TopicFollow[]> {
  return toggleFollow('PUT', follow)
}

export function deleteTopic(follow: TopicFollow): Promise<TopicFollow[]> {
  return toggleFollow('DELETE', follow)
}

export async function fetchMyNotes(): Promise<UserNote[]> {
  const data = await getJson<{ notes: UserNote[] }>('/api/my/notes')
  return data?.notes ?? []
}

export async function addMyNote(body: string): Promise<UserNote> {
  const response = await fetch('/api/my/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ body }),
  })
  if (!response.ok) {
    throw new Error(`Could not save the note (${response.status}). Try again in a moment.`)
  }
  return (await response.json() as { note: UserNote }).note
}

export async function deleteMyNote(id: string): Promise<UserNote[]> {
  const response = await fetch(`/api/my/notes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', ...(await authHeaders()) },
  })
  if (!response.ok) {
    throw new Error(`Could not delete the note (${response.status}). Try again in a moment.`)
  }
  return (await response.json() as { notes: UserNote[] }).notes
}

export interface SourceStatInfo {
  name: string
  family: string
  count: number
  durationMs: number
  error: string | null
}

export interface CleanStatsInfo {
  raw: number
  fresh: number
  duplicatesRemoved: number
  alreadyPublished: number
}

export interface ResearchSessionSummary {
  id: string
  mode: 'query' | 'weekly'
  query: string
  days: number
  status: 'running' | 'succeeded' | 'failed'
  current_node: string
  stats: {
    sourceStats?: SourceStatInfo[]
    cleanStats?: CleanStatsInfo
    scoredCount?: number
    fetchedCount?: number
    sectionCount?: number
    warnings?: string[]
    reportId?: string | null
  }
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface StreamedSectionItem {
  section: 'top' | 'tool' | 'worth'
  item: {
    title: string
    url: string
    source: string
    published: string
    snippet: string
    score: number
    well7_fit: number
    reason: string
  }
  summary: {
    summary: string
    origin: 'full text' | 'snippet only'
    guard: 'passed' | 'repaired' | 'extractive' | 'skipped'
  }
}

export interface ResearchSessionDetail extends ResearchSessionSummary {
  result: {
    sections?: StreamedSectionItem[]
    scoredItems?: Array<{
      title: string
      url: string
      source: string
      published: string
      snippet: string
      score: number
      well7_fit: number
      reason: string
    }>
    cleanItems?: Array<{
      title: string
      url: string
      source: string
      published: string
      snippet: string
    }>
    trend?: string
    sourceStats?: SourceStatInfo[]
    cleanStats?: CleanStatsInfo
    warnings?: string[]
    reportId?: string | null
  }
}

export interface ResearchNodeStreamEvent {
  sessionId: string
  node: 'collect' | 'clean' | 'rank' | 'fetch' | 'summarise' | 'publish'
  status: 'completed'
  timestamp: string
  summary: Record<string, unknown>
  stateSnapshot: ResearchSessionDetail['result']
}

export async function fetchResearchSessions(): Promise<ResearchSessionSummary[]> {
  try {
    const response = await fetch('/api/research/sessions', { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const data = (await response.json()) as { sessions?: ResearchSessionSummary[] }
    return data.sessions ?? []
  } catch {
    return []
  }
}

export async function fetchResearchSession(id: string): Promise<ResearchSessionDetail | null> {
  try {
    const response = await fetch(`/api/research/sessions/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null
    const data = (await response.json()) as { session?: ResearchSessionDetail }
    return data.session ?? null
  } catch {
    return null
  }
}

export async function streamResearchRun(
  params: {
    mode?: 'query' | 'weekly'
    query: string
    days: number
    sourceFamilies?: string[]
  },
  handlers: {
    onStart?: (info: { sessionId: string; mode: 'query' | 'weekly'; query: string; days: number }) => void
    onNode: (event: ResearchNodeStreamEvent) => void
    onDone: (session: ResearchSessionDetail) => void
    onError: (message: string) => void
  },
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/research/stream', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(await authHeaders()),
    },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const errBody = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(errBody?.error ?? `Could not start live research (${response.status}).`)
  }
  if (!response.body) {
    throw new Error('Streaming response body unavailable.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      const lines = block.split('\n')
      let eventType = 'message'
      let dataText = ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        else if (line.startsWith('data:')) dataText += line.slice(5).trim()
      }
      if (!dataText) continue
      try {
        const parsed = JSON.parse(dataText)
        if (eventType === 'start') handlers.onStart?.(parsed)
        else if (eventType === 'node') handlers.onNode(parsed as ResearchNodeStreamEvent)
        else if (eventType === 'done') handlers.onDone(parsed as ResearchSessionDetail)
        else if (eventType === 'error') handlers.onError(String(parsed?.error ?? 'Research run failed.'))
      } catch {
        // Ignore malformed frame
      }
    }
  }
}
