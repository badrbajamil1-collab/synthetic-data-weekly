import { useCallback, useEffect, useState } from 'react'

import type { Report, ReportItem } from '@/lib/report'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The report archive could not be loaded. Try again.'
}

export interface ReportsResult {
  reports: Report[]
  loading: boolean
  error: string | null
  retry: () => void
}

/** Loads every report id + week; shared by the landing, brief, feed and archive pages. */
export function useReports(): ReportsResult {
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const retry = useCallback(() => setRetryTick((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/reports', { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`The report archive returned an error (${response.status}). Try again.`)
        }
        const data = (await response.json()) as { reports?: Report[] }
        setReports(data.reports ?? [])
      } catch (caught) {
        if (!controller.signal.aborted) setError(getErrorMessage(caught))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [retryTick])

  return { reports, loading, error, retry }
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

/** Loads one week's brief + items; shared by the brief and feed pages. */
export function useReport(id: string | null): ReportResult {
  const [report, setReport] = useState<Report | null>(null)
  const [items, setItems] = useState<ReportItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const retry = useCallback(() => setRetryTick((value) => value + 1), [])

  useEffect(() => {
    setReport(null)
    setItems([])
    setNotFound(false)
    setError(null)
    setLoading(false)
    if (!id) return

    const controller = new AbortController()

    async function load() {
      setLoading(true)
      try {
        const [reportResponse, itemsResponse] = await Promise.all([
          fetch(`/api/reports/${id}`, { signal: controller.signal }),
          fetch(`/api/reports/${id}/items`, { signal: controller.signal }),
        ])
        if (reportResponse.status === 404 || itemsResponse.status === 404) {
          setNotFound(true)
          return
        }
        if (!reportResponse.ok || !itemsResponse.ok) {
          throw new Error('This brief could not be loaded. Try again or choose another week.')
        }
        const [reportData, itemsData] = await Promise.all([
          reportResponse.json() as Promise<{ report: Report }>,
          itemsResponse.json() as Promise<{ items?: ReportItem[] }>,
        ])
        setReport(reportData.report)
        setItems(itemsData.items ?? [])
      } catch (caught) {
        if (!controller.signal.aborted) setError(getErrorMessage(caught))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [id, retryTick])

  return { report, items, loading, error, notFound, retry }
}
