import { useCallback, useEffect, useState } from 'react'

import type { Report, ReportItem } from '@/lib/report'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The report archive could not be loaded. Try again.'
}

// Lightweight in-memory caches so route transitions (e.g. / -> /brief -> /brief/<id>)
// do not trigger redundant fetches or double skeleton flashes.
let cachedReports: Report[] | null = null
const cachedReportDetails = new Map<string, { report: Report; items: ReportItem[] }>()

export function invalidateReportsCache(): void {
  cachedReports = null
  cachedReportDetails.clear()
}

export interface ReportsResult {
  reports: Report[]
  loading: boolean
  error: string | null
  retry: () => void
}

interface ReportsState {
  reports: Report[]
  loading: boolean
  error: string | null
}

/** Loads every report id + week; shared by the landing, brief, feed and archive pages. */
export function useReports(): ReportsResult {
  const [state, setState] = useState<ReportsState>(() => ({
    reports: cachedReports ?? [],
    loading: cachedReports === null,
    error: null,
  }))
  const [retryTick, setRetryTick] = useState(0)

  const retry = useCallback(() => {
    cachedReports = null
    setState((prev) => ({ ...prev, loading: true, error: null }))
    setRetryTick((value) => value + 1)
  }, [])

  useEffect(() => {
    if (retryTick === 0 && cachedReports !== null) return
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch('/api/reports', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`The report archive returned an error (${response.status}). Try again.`)
        }
        const data = (await response.json()) as { reports?: Report[] }
        const list = data.reports ?? []
        cachedReports = list
        setState({ reports: list, loading: false, error: null })
      } catch (caught) {
        if (!controller.signal.aborted) {
          setState((prev) => ({ ...prev, loading: false, error: getErrorMessage(caught) }))
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [retryTick])

  return { ...state, retry }
}

export interface ReportResult {
  report: Report | null
  items: ReportItem[]
  loading: boolean
  error: string | null
  /** True when the API answered 404 — a deep link to a week that does not exist. */
  notFound: boolean
  retry: () => void
}

interface LoadedReportState {
  forId: string | null
  report: Report | null
  items: ReportItem[]
  error: string | null
  notFound: boolean
}

/** Loads one week's brief + items; shared by the brief and feed pages. */
export function useReport(id: string | null): ReportResult {
  const [retryTick, setRetryTick] = useState(0)
  const [loaded, setLoaded] = useState<LoadedReportState>(() => {
    if (id && cachedReportDetails.has(id)) {
      const hit = cachedReportDetails.get(id)!
      return { forId: id, report: hit.report, items: hit.items, error: null, notFound: false }
    }
    return { forId: null, report: null, items: [], error: null, notFound: false }
  })

  const retry = useCallback(() => {
    if (id) cachedReportDetails.delete(id)
    setLoaded({ forId: null, report: null, items: [], error: null, notFound: false })
    setRetryTick((value) => value + 1)
  }, [id])

  useEffect(() => {
    if (!id) return
    if (retryTick === 0 && cachedReportDetails.has(id)) return

    const controller = new AbortController()

    async function load() {
      try {
        const [reportResponse, itemsResponse] = await Promise.all([
          fetch(`/api/reports/${encodeURIComponent(id!)}`, { signal: controller.signal }),
          fetch(`/api/reports/${encodeURIComponent(id!)}/items`, { signal: controller.signal }),
        ])
        if (reportResponse.status === 404 || itemsResponse.status === 404) {
          setLoaded({ forId: id, report: null, items: [], error: null, notFound: true })
          return
        }
        if (!reportResponse.ok || !itemsResponse.ok) {
          throw new Error('This brief could not be loaded. Try again or choose another week.')
        }
        const [reportData, itemsData] = await Promise.all([
          reportResponse.json() as Promise<{ report: Report }>,
          itemsResponse.json() as Promise<{ items?: ReportItem[] }>,
        ])
        const itemsList = itemsData.items ?? []
        cachedReportDetails.set(id!, { report: reportData.report, items: itemsList })
        setLoaded({
          forId: id,
          report: reportData.report,
          items: itemsList,
          error: null,
          notFound: false,
        })
      } catch (caught) {
        if (!controller.signal.aborted) {
          setLoaded({
            forId: id,
            report: null,
            items: [],
            error: getErrorMessage(caught),
            notFound: false,
          })
        }
      }
    }

    void load()
    return () => controller.abort()
  }, [id, retryTick])

  if (!id) {
    return { report: null, items: [], loading: false, error: null, notFound: false, retry }
  }

  const cached = cachedReportDetails.get(id)
  if (cached) {
    return { report: cached.report, items: cached.items, loading: false, error: null, notFound: false, retry }
  }

  if (loaded.forId !== id) {
    return { report: null, items: [], loading: true, error: null, notFound: false, retry }
  }

  return {
    report: loaded.report,
    items: loaded.items,
    loading: false,
    error: loaded.error,
    notFound: loaded.notFound,
    retry,
  }
}
