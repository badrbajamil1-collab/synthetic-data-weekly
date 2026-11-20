import { useEffect, useState } from 'react'

/**
 * Tiny history router (no extra dependency). `useRoute` re-renders on popstate
 * and on `navigate`; trailing slashes are normalized so `/archive/` resolves
 * cleanly alongside `/archive`. Query strings are preserved in `window.location.search`.
 */

export function normalizePath(rawPath: string): string {
  if (!rawPath || rawPath === '/') return '/'
  const trimmed = rawPath.replace(/\/+$/, '')
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function currentPath(): string {
  return normalizePath(window.location.pathname)
}

function currentLocation(): string {
  return `${currentPath()}${window.location.search}`
}

const subscribers = new Set<() => void>()

export function navigate(to: string, options?: { replace?: boolean }): void {
  const raw = to.startsWith('/') ? to : `/${to}`
  const qIndex = raw.indexOf('?')
  const pathPart = qIndex >= 0 ? raw.slice(0, qIndex) : raw
  const searchPart = qIndex >= 0 ? raw.slice(qIndex) : ''
  const target = `${normalizePath(pathPart)}${searchPart}`

  if (target === currentLocation()) return
  if (options?.replace) window.history.replaceState(null, '', target)
  else window.history.pushState(null, '', target)
  for (const subscriber of subscribers) subscriber()
}

export function useRoute(): string {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const update = () => setPath(currentPath())
    subscribers.add(update)
    window.addEventListener('popstate', update)
    return () => {
      subscribers.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return path
}

export function useLocationSearch(): string {
  const [search, setSearch] = useState(() => window.location.search)
  useEffect(() => {
    const update = () => setSearch(window.location.search)
    subscribers.add(update)
    window.addEventListener('popstate', update)
    return () => {
      subscribers.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return search
}
