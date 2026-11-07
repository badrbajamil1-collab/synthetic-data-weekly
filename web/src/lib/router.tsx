import { useEffect, useState, type AnchorHTMLAttributes } from 'react'

/**
 * Tiny history router (spec `2026-11-06-pages-and-feed-design.md`: no new
 * dependency). `useRoute` re-renders on popstate and on `navigate`; `Link`
 * intercepts plain left-clicks and lets browsers handle modified/new-tab
 * clicks.
 */

function currentPath(): string {
  return window.location.pathname
}

const subscribers = new Set<() => void>()

export function navigate(to: string, options?: { replace?: boolean }): void {
  const target = to.startsWith('/') ? to : `/${to}`
  if (target === currentPath()) return
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

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
}

export function Link({ to, onClick, ...rest }: LinkProps) {
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (to.startsWith('#')) return
        event.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}
