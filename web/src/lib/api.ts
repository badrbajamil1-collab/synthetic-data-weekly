export interface Me {
  user_id: string
  email: string
  isAdmin: boolean
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
  if (response.status === 401) return null
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
