import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { CircleAlert, Menu, X } from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import {
  authHeaders,
  deleteTopic,
  errorText,
  getJson,
  putTopic,
  saveState,
  setApiTokenGetter,
  type LibraryBundle,
  type LibraryEntry,
  type Me,
} from '@/lib/api'
import { Link, useRoute } from '@/lib/router'
import { sortFollows, sameSource, type TopicFollow, type TopicKind } from '@/lib/topics'
import { ArchivePage } from '@/pages/ArchivePage'
import { BriefPage } from '@/pages/BriefPage'
import { FeedPage } from '@/pages/FeedPage'
import { LandingPage } from '@/pages/LandingPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { StudioPage } from '@/pages/StudioPage'
import { cn } from '@/lib/utils'

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The archive could not be loaded. Try again.'
}

interface NavLinkProps {
  to: string
  active: boolean
  highlight?: boolean
  className?: string
  children: string
  onClick?: () => void
}

function NavLink({ to, active, highlight, className, children, onClick }: NavLinkProps) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : highlight
            ? 'font-medium text-ink hover:bg-secondary hover:text-primary'
            : 'text-muted-foreground hover:bg-secondary/70 hover:text-ink',
        className,
      )}
    >
      {highlight && (
        <span
          className="size-1.5 rounded-full bg-emerald-500"
          aria-hidden="true"
        />
      )}
      {children}
    </Link>
  )
}

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/studio/, 'Live Research Studio'],
  [/^\/feed/, 'Your feed'],
  [/^\/library/, 'Your library'],
  [/^\/archive/, 'Archive'],
  [/^\/brief/, 'Weekly brief'],
]

function pageTitle(route: string): string {
  if (route === '/') return 'Well7 Research Lab — Synthetic Data Weekly'
  const found = ROUTE_TITLES.find(([pattern]) => pattern.test(route))
  return `${found ? found[1] : 'Page not found'} — Well7 Research Lab`
}

export default function App() {
  const route = useRoute()
  const [me, setMe] = useState<Me | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [meError, setMeError] = useState<string | null>(null)
  const [meRetryTick, setMeRetryTick] = useState(0)
  const [topics, setTopics] = useState<TopicFollow[]>([])
  const [followError, setFollowError] = useState<string | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [studioQuerySeed, setStudioQuerySeed] = useState('')

  const { getToken, userId, isLoaded } = useAuth()
  const clerk = useClerk()
  const getTokenRef = useRef(getToken)
  useEffect(() => {
    getTokenRef.current = getToken
  }, [getToken])

  useEffect(() => {
    setApiTokenGetter(() => getTokenRef.current())
  }, [])

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      const data = await getJson<{ items: LibraryEntry[] }>('/api/my/library')
      setLibrary(data?.items ?? [])
    } catch (error) {
      setLibraryError(errorText(error))
    } finally {
      setLibraryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    let active = true

    async function loadMe() {
      if (!userId) {
        if (active) {
          setMe(null)
          setTopics([])
          setLibrary([])
          setMeError(null)
          setSessionChecked(true)
        }
        return
      }
      try {
        const user = await getJson<Me>('/api/me')
        if (active) {
          if (user) {
            setMe(user)
            setTopics(sortFollows(user.topics ?? []))
          } else {
            setMe(null)
            setTopics([])
          }
          setMeError(null)
        }
      } catch (error) {
        if (active) {
          setMe(null)
          setTopics([])
          setMeError(errorText(error))
        }
      }
      if (active) {
        void loadLibrary()
        setSessionChecked(true)
      }
    }

    void loadMe()
    return () => {
      active = false
    }
  }, [isLoaded, userId, loadLibrary, meRetryTick])

  const retryMe = useCallback(() => {
    setMeError(null)
    setMeRetryTick((value) => value + 1)
  }, [])

  async function toggleFollow(kind: TopicKind, value: string, next: boolean) {
    setFollowError(null)
    const matches = (follow: TopicFollow) =>
      follow.kind === kind && (kind === 'source' ? sameSource(follow.value, value) : follow.value === value)
    const before = topics
    const stored = before.find(matches)
    setTopics(
      sortFollows(
        next
          ? [...before.filter((follow) => !matches(follow)), { kind, value }]
          : before.filter((follow) => !matches(follow)),
      ),
    )
    try {
      const updated = next
        ? await putTopic({ kind, value })
        : await deleteTopic({ kind, value: stored?.value ?? value })
      setTopics(sortFollows(updated))
    } catch (error) {
      setTopics(before)
      setFollowError(errorText(error))
    }
  }

  const togglePaper = useCallback(async (itemId: string, field: 'read_later' | 'important') => {
    const current = library.find((entry) => entry.id === itemId)
    setLibraryError(null)
    try {
      await saveState(itemId, {
        read_later: field === 'read_later' ? current?.read_later !== 1 : current?.read_later === 1,
        important: field === 'important' ? current?.important !== 1 : current?.important === 1,
      })
      await loadLibrary()
    } catch (error) {
      setLibraryError(errorText(error))
    }
  }, [library, loadLibrary])

  const saveNote = useCallback(async (itemId: string, note: string) => {
    setLibraryError(null)
    try {
      await saveState(itemId, { note })
      await loadLibrary()
    } catch (error) {
      setLibraryError(errorText(error))
    }
  }, [loadLibrary])

  async function runPipeline() {
    setRunning(true)
    setPipelineError(null)
    try {
      const response = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { Accept: 'application/json', ...(await authHeaders()) },
      })
      const body = (await response.json()) as { status?: string; error?: string }
      if (!response.ok || body.status !== 'succeeded') {
        throw new Error(body.error ?? `The run failed (${response.status}). Try again in a moment.`)
      }
      window.location.reload()
    } catch (error) {
      setPipelineError(getErrorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  const savedById = useMemo(() => new Map(library.map((entry) => [entry.id, entry])), [library])
  const libraryBundle = useMemo<LibraryBundle>(() => ({
    entries: library,
    savedById,
    loading: libraryLoading,
    error: libraryError,
    togglePaper,
    saveNote,
    reload: () => void loadLibrary(),
  }), [library, savedById, libraryLoading, libraryError, togglePaper, saveNote, loadLibrary])

  const signedIn = Boolean(userId)
  const active = (path: string) => route === path || (path !== '/' && route.startsWith(path))
  const briefWeek = route.match(/^\/brief\/([^/]+)$/)?.[1]
  const needsIdentity = route === '/feed' || route === '/library'
  const identityPending = needsIdentity && (!isLoaded || !sessionChecked)

  const firstRouteRef = useRef(true)
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    /* eslint-disable react/set-state-in-effect */
    setFollowError(null)
    setLibraryError(null)
    setPipelineError(null)
    setMenuOpen(false)
    /* eslint-enable react/set-state-in-effect */
    document.title = pageTitle(route)
    if (firstRouteRef.current) {
      firstRouteRef.current = false
      return
    }
    window.scrollTo(0, 0)
    mainRef.current?.focus({ preventScroll: true })
  }, [route])

  const navLinks: Array<{ to: string; label: string; highlight?: boolean }> = signedIn
    ? [
        { to: '/studio', label: 'Live Check', highlight: true },
        { to: '/feed', label: 'Feed' },
        { to: '/brief', label: 'Brief' },
        { to: '/library', label: 'Library' },
        { to: '/archive', label: 'Archive' },
      ]
    : [
        { to: '/studio', label: 'Live Check', highlight: true },
        { to: '/brief', label: 'Brief' },
        { to: '/archive', label: 'Archive' },
      ]

  const isKnownRoute =
    route === '/' ||
    route === '/studio' ||
    route === '/brief' ||
    route.startsWith('/brief/') ||
    route === '/feed' ||
    route === '/library' ||
    route === '/archive'

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-ink">
      <a
        href="#top"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-5 focus-visible:top-3 focus-visible:z-[60] focus-visible:rounded-lg focus-visible:bg-white focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-ink focus-visible:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-white/95 text-ink backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to={signedIn ? '/library' : '/'} className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3">
            <BrandMark className="size-9 shrink-0" />
            <span className="whitespace-nowrap">
              <span className="block font-display text-base font-medium leading-tight text-ink sm:text-lg" translate="no">Well7 Research Lab</span>
              <span className="hidden text-xs text-muted-foreground sm:block">Synthetic Data Weekly</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
            {navLinks.map((link) => (
              <NavLink key={link.to} to={link.to} active={active(link.to)} highlight={link.highlight}>
                {link.label}
              </NavLink>
            ))}
            {signedIn && me?.email && (
              <span className="ml-2 hidden max-w-44 truncate text-xs text-muted-foreground lg:block">{me.email}</span>
            )}
            <div className="ml-2 flex items-center gap-2">
              {signedIn ? (
                <UserButton />
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clerk.openSignUp()}
                  >
                    Sign up
                  </Button>
                  <Button
                    size="sm"
                    variant="ink"
                    onClick={() => clerk.openSignIn()}
                  >
                    Sign in
                  </Button>
                </>
              )}
            </div>
          </nav>

          <div className="flex items-center gap-2 md:hidden">
            {signedIn && <UserButton />}
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-9 place-items-center rounded-full border border-border bg-white text-ink transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {menuOpen ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id="mobile-navigation" className="border-t border-border/80 bg-white px-5 pb-5 pt-3 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  active={active(link.to)}
                  highlight={link.highlight}
                  className="w-full justify-start"
                >
                  {link.label}
                </NavLink>
              ))}
              {!signedIn && (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => { setMenuOpen(false); clerk.openSignUp() }}
                  >
                    Sign up
                  </Button>
                  <Button
                    size="sm"
                    variant="ink"
                    className="flex-1"
                    onClick={() => { setMenuOpen(false); clerk.openSignIn() }}
                  >
                    Sign in
                  </Button>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      {followError && (
        <div className="mx-auto mt-3 max-w-7xl px-5 sm:px-8" role="alert">
          <p className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-[#fff5f7] px-4 py-2.5 text-sm text-destructive">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {followError}
          </p>
        </div>
      )}

      {signedIn && meError && (
        <div className="mx-auto mt-3 max-w-7xl px-5 sm:px-8" role="alert">
          <p className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/25 bg-[#fff5f7] px-4 py-2.5 text-sm text-destructive">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>{meError}</span>
            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={retryMe}>
              Try again
            </Button>
          </p>
        </div>
      )}

      <main
        id="top"
        key={route}
        ref={mainRef}
        tabIndex={-1}
        className="route-in focus:outline-none focus-visible:outline-none"
      >
        {identityPending && (
          <section className="mx-auto max-w-3xl px-5 py-24 text-center" aria-live="polite">
            <p className="text-sm text-muted-foreground">Loading your session…</p>
          </section>
        )}

        {!identityPending && (
          <>
            {route === '/' && <LandingPage onLaunchStudio={(q) => setStudioQuerySeed(q)} />}

            {route === '/studio' && (
              <StudioPage
                initialQuery={studioQuerySeed}
                signedIn={signedIn}
                isAdmin={Boolean(me?.isAdmin)}
                onSignIn={() => clerk.openSignIn()}
                library={libraryBundle}
                follows={signedIn ? topics : undefined}
                onFollow={signedIn ? toggleFollow : undefined}
              />
            )}

            {route === '/brief' || route.startsWith('/brief/') ? (
              <BriefPage
                week={briefWeek}
                signedIn={signedIn}
                library={libraryBundle}
                follows={signedIn ? topics : undefined}
                onFollow={signedIn ? toggleFollow : undefined}
              />
            ) : null}

            {route === '/feed' && (
              <FeedPage
                signedIn={signedIn}
                follows={topics}
                onFollow={toggleFollow}
                onSignIn={() => clerk.openSignIn()}
                library={libraryBundle}
              />
            )}

            {route === '/library' && <LibraryPage signedIn={signedIn} library={libraryBundle} />}

            {route === '/archive' && (
              <ArchivePage
                isAdmin={Boolean(me?.isAdmin)}
                running={running}
                onRunPipeline={() => void runPipeline()}
              />
            )}

            {!isKnownRoute && <NotFoundPage />}
          </>
        )}

        {route === '/archive' && pipelineError && (
          <div className="mx-auto max-w-7xl px-5 pb-10 sm:px-8" role="alert">
            <p className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-[#fff5f7] px-4 py-2.5 text-sm text-destructive">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              {pipelineError}
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-border/80 bg-white/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-6 shrink-0" />
            <span className="font-medium text-ink" translate="no">Well7 Research Lab</span>
          </div>
          <p>Well7 Research Lab · Live LangGraph.js Research Studio & Weekly Archive.</p>
        </div>
      </footer>
    </div>
  )
}
