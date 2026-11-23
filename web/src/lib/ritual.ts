import { useCallback, useEffect, useMemo, useState } from 'react'

import type { ReportItem } from './report.ts'

const STORAGE_PREFIX = 'well7:ritual-read:'
const SYNC_EVENT = 'well7:ritual-sync'

export function estimateItemMinutes(item: Pick<ReportItem, 'summary' | 'reason'>): number {
  const words = `${item.summary ?? ''} ${item.reason ?? ''}`
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return words >= 42 ? 2 : 1
}

export function estimateBriefMinutes(items: Array<Pick<ReportItem, 'summary' | 'reason'>>): number {
  if (items.length === 0) return 0
  const total = items.reduce((sum, item) => sum + estimateItemMinutes(item), 0)
  return Math.max(2, total)
}

export function countReadInItems(
  readIds: ReadonlySet<string>,
  items: ReadonlyArray<Pick<ReportItem, 'id'>>,
): number {
  let count = 0
  for (const item of items) {
    if (readIds.has(item.id)) count += 1
  }
  return count
}

export function loadReadIds(reportId: string): string[] {
  if (!reportId || typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${reportId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function persistReadId(reportId: string, itemId: string): string[] {
  if (!reportId || !itemId) return []
  const existing = loadReadIds(reportId)
  if (existing.includes(itemId)) return existing
  const next = [...existing, itemId]
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${reportId}`, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { reportId, ids: next } }))
    } catch {
      // Ignore storage quota or private-mode restrictions.
    }
  }
  return next
}

export function useRitualProgress(
  reportId: string | null,
  items: ReadonlyArray<Pick<ReportItem, 'id'>>,
) {
  const [state, setState] = useState<{ forId: string | null; ids: string[] }>(() => ({
    forId: reportId,
    ids: reportId ? loadReadIds(reportId) : [],
  }))

  const activeIds = useMemo(
    () => (state.forId === reportId ? state.ids : reportId ? loadReadIds(reportId) : []),
    [state, reportId],
  )

  useEffect(() => {
    if (!reportId || typeof window === 'undefined') return
    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ reportId: string; ids: string[] }>).detail
      if (detail?.reportId === reportId) {
        setState({ forId: reportId, ids: detail.ids })
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === `${STORAGE_PREFIX}${reportId}`) {
        setState({ forId: reportId, ids: loadReadIds(reportId) })
      }
    }
    window.addEventListener(SYNC_EVENT, onSync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync)
      window.removeEventListener('storage', onStorage)
    }
  }, [reportId])

  const readIds = useMemo(() => new Set(activeIds), [activeIds])
  const readCount = useMemo(() => countReadInItems(readIds, items), [readIds, items])
  const totalCount = items.length
  const percent = totalCount > 0 ? Math.round((readCount / totalCount) * 100) : 0

  const markRead = useCallback(
    (itemId: string) => {
      if (!reportId || !itemId) return
      const next = persistReadId(reportId, itemId)
      setState({ forId: reportId, ids: next })
    },
    [reportId],
  )

  return { readIds, readCount, totalCount, percent, markRead }
}
