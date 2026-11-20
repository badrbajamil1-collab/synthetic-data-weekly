import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { UserButton, useAuth, useClerk } from '@clerk/react'
import { CircleAlert, Menu } from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import { Link } from '@/components/link'
import { MobileNavDrawer } from '@/components/mobile-nav-drawer'
import { Button } from '@/components/ui/button'
import {
  deleteTopic,
  errorText,
  getJson,
  putTopic,
  runPipelineRequest,
  saveState,
  setApiTokenGetter,
  type LibraryBundle,
  type LibraryEntry,
  type Me,
  type SavableItemMeta,
} from '@/lib/api'
import { useRoute } from '@/lib/router'
import { sameFollow, sortFollows, type TopicFollow, type TopicKind } from '@/lib/topics'
import { invalidateReportsCache } from '@/lib/use-report'
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
        'relative inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'bg-primary/10 font-semibold text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary'
          : highlight
            ? 'font-medium text-ink hover:bg-secondary hover:text-primary'
            : 'text-muted-foreground hover:bg-secondary/70 hover:text-ink',
        className,
      )}
    >
      {highlight && (
        <span
          className="size-1.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      )}
      {children}
    </Link>
  )
}

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/studio$/, 'Live Search'],
  [/^\/feed$/, 'Your feed'],
  [/^\/library$/, 'Your library'],
  [/^\/archive$/, 'Archive'],
  [/^\/brief(?:\/|$)/, 'Weekly brief'],
]

function pageTitle(route: string): string {
  if (route === '/') return 'Well7 Research Lab — Synthetic Data Weekly'
  const found = ROUTE_TITLES.find(([pattern]) => pattern.test(route))
  return `${found ? found[1] : 'Page not found'} — Well7 Research Lab`
}

interface ScopedError {
  route: string
  message: string
}

export default function App() {
  const route = useRoute()
  const [me, setMe] = useState<Me | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [meError, setMeError] = useState<string | null>(null)
  const [meRetryTick, setMeRetryTick] = useState(0)
  const [topics, setTopics] = useState<TopicFollow[]>([])
  const [followErr, setFollowErr] = useState<ScopedError | null>(null)
  const [library, setLibrary] = useState<LibraryEntry[]>([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryErr, setLibraryErr] = useState<ScopedError | null>(null)
  const [running, setRunning] = useState(false)
  const [pipelineErr, setPipelineErr] = useState<ScopedError | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [routeAnnouncement, setRouteAnnouncement] = useState('')

  const followError = followErr?.route === route ? followErr.message : null
  const libraryError = libraryErr?.route === route ? libraryErr.message : null
  const pipelineError = pipelineErr?.route === route ? pipelineErr.message : null

  const { getToken, userId, isLoaded } = useAuth()
  const clerk = useClerk()
  const getTokenRef = useRef(getToken)
  const topicsRef = useRef(topics)
  const libraryRef = useRef(library)
  const routeRef = useRef(route)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    getTokenRef.current = getToken
    setApiTokenGetter((opts) => getTokenRef.current(opts))
  }, [getToken])

  useEffect(() => {
    topicsRef.current = topics
  }, [topics])

  useEffect(() => {
    libraryRef.current = library
  }, [library])

  useEffect(() => {
    routeRef.current = route
  }, [route])

  const loadLibrary = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLibraryLoading(true)
    setLibraryErr(null)
    try {
      const data = await getJson<{ items: LibraryEntry[] }>('/api/my/library')
      setLibrary(data?.items ?? [])
    } catch (error) {
      setLibraryErr({ route: routeRef.current, message: errorText(error) })
    } finally {
      if (!options?.silent) setLibraryLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) return
    let active = true
    const attempt = meRetryTick

    async function loadMe() {
      if (attempt < 0) return
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
    setFollowErr(null)
    const before = topicsRef.current
    const stored = before.find((follow) => sameFollow(follow, kind, value))
    const optimistic = sortFollows(
      next
        ? [...before.filter((follow) => !sameFollow(follow, kind, value)), { kind, value }]
        : before.filter((follow) => !sameFollow(follow, kind, value)),
    )
    topicsRef.current = optimistic
    setTopics(optimistic)
    try {
      const updated = next
        ? await putTopic({ kind, value })
        : await deleteTopic({ kind, value: stored?.value ?? value })
      const sorted = sortFollows(updated)
      topicsRef.current = sorted
      setTopics(sorted)
    } catch (error) {
      topicsRef.current = before
      setTopics(before)
      setFollowErr({ route: routeRef.current, message: errorText(error) })
    }
  }

  const togglePaper = useCallback(
    async (itemId: string, field: 'read_later' | 'important', itemMeta?: SavableItemMeta) => {
      setLibraryErr(null)
      const prevList = libraryRef.current
      const current = prevList.find((entry) => entry.id === itemId)
      const nextReadLater = field === 'read_later' ? current?.read_later !== 1 : current?.read_later === 1
      const nextImportant = field === 'important' ? current?.important !== 1 : current?.important === 1
      const nowIso = new Date().toISOString()

      const optimistic = (() => {
        const existing = prevList.find((entry) => entry.id === itemId)
        if (!nextReadLater && !nextImportant && !existing?.note) {
          return prevList.filter((entry) => entry.id !== itemId)
        }
        if (existing) {
          return prevList.map((entry) =>
            entry.id === itemId
              ? {
                  ...entry,
                  read_later: nextReadLater ? 1 : 0,
                  important: nextImportant ? 1 : 0,
                  updated_at: nowIso,
                }
              : entry,
          )
        }
        return [
          {
            id: itemId,
            title: itemMeta?.title ?? 'Saved item',
            url: itemMeta?.url ?? '',
            source: itemMeta?.source ?? 'web',
            published: itemMeta?.published ?? nowIso.slice(0, 10),
            score: Number(itemMeta?.score ?? 7),
            reason: itemMeta?.reason ?? '',
            summary: itemMeta?.summary ?? '',
            section: itemMeta?.section ?? 'top',
            week_end: itemMeta?.week_end ?? itemMeta?.published ?? nowIso.slice(0, 10),
            read_later: nextReadLater ? 1 : 0,
            important: nextImportant ? 1 : 0,
            note: '',
            updated_at: nowIso,
          },
          ...prevList,
        ]
      })()
      libraryRef.current = optimistic
      setLibrary(optimistic)

      try {
        await saveState(itemId, {
          read_later: nextReadLater,
          important: nextImportant,
          item: itemMeta,
        })
        await loadLibrary({ silent: true })
      } catch (error) {
        await loadLibrary({ silent: true })
        setLibraryErr({ route: routeRef.current, message: errorText(error) })
      }
    },
    [loadLibrary],
  )

  const saveNote = useCallback(async (itemId: string, note: string) => {
    setLibraryErr(null)
    try {
      await saveState(itemId, { note })
      await loadLibrary({ silent: true })
    } catch (error) {
      setLibraryErr({ route: routeRef.current, message: errorText(error) })
    }
  }, [loadLibrary])

  async function runPipeline() {
    setRunning(true)
    setPipelineErr(null)
    try {
      await runPipelineRequest()
      invalidateReportsCache()
      window.location.reload()
    } catch (error) {
      setPipelineErr({ route: routeRef.current, message: getErrorMessage(error) })
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
  const active = (path: string) =>
    path === '/' ? route === '/' : route === path || route.startsWith(`${path}/`)
  const briefWeek = route.match(/^\/brief\/([^/]+)$/)?.[1]
  const needsIdentity = route === '/feed' || route === '/library'
  const identityPending = needsIdentity && (!isLoaded || !sessionChecked)

  const firstRouteRef = useRef(true)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const title = pageTitle(route)
    document.title = title
    if (firstRouteRef.current) {
      firstRouteRef.current = false
      return
    }
    window.scrollTo({ top: 0, behavior: 'instant' })
    mainRef.current?.focus({ preventScroll: true })
    const timer = window.setTimeout(() => setRouteAnnouncement(title), 50)
    return () => window.clearTimeout(timer)
  }, [route])

  // Close mobile drawer automatically on browser back/forward navigation.
  useEffect(() => {
    const handlePop = () => setMenuOpen(false)
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [])

  const navLinks: Array<{ to: string; label: string; highlight?: boolean }> = signedIn
    ? [
        { to: '/studio', label: 'Live Search', highlight: true },
        { to: '/feed', label: 'Feed' },
        { to: '/brief', label: 'Brief' },
        { to: '/library', label: 'Library' },
        { to: '/archive', label: 'Archive' },
      ]
    : [
        { to: '/studio', label: 'Live Search', highlight: true },
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
    <div className="flex min-h-screen flex-col overflow-x-clip bg-background text-ink">
      <div role="status" aria-live="polite" className="sr-only">
        {routeAnnouncement}
      </div>

      <a
        href="#top"
        className="sr-only focus:not-sr-only focus:fixed focus:left-5 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-md focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-50 border-b border-border/80 bg-white/95 text-ink backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link
            to="/"
            aria-label="Well7 Research Lab — Home"
            className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3"
          >
            <BrandMark className="size-9 shrink-0" />
            <span className="whitespace-nowrap">
              <span className="block font-display text-base font-medium leading-tight text-ink sm:text-lg" translate="no">
                Well7 Research Lab
              </span>
              <span className="hidden text-xs text-muted-foreground sm:block">Synthetic Data Weekly</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {navLinks.map((link) => (
              <NavLink key={link.to} to={link.to} active={active(link.to)} highlight={link.highlight}>
                {link.label}
              </NavLink>
            ))}
            <div className="ml-3 flex items-center gap-2 border-l border-border/80 pl-3">
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
              ref={menuButtonRef}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid size-11 cursor-pointer place-items-center rounded-full border border-border bg-white text-ink transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Menu className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <MobileNavDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        links={navLinks}
        isActive={active}
        signedIn={signedIn}
        onSignUp={() => clerk.openSignUp()}
        onSignIn={() => clerk.openSignIn()}
        triggerRef={menuButtonRef}
      />

      {followError && (
        <div className="mx-auto mt-3 w-full max-w-7xl px-5 sm:px-8" role="alert">
          <div className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-[#fff5f7] px-4 py-2.5 text-sm text-destructive">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>{followError}</span>
          </div>
        </div>
      )}

      {signedIn && meError && (
        <div className="mx-auto mt-3 w-full max-w-7xl px-5 sm:px-8" role="alert">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/25 bg-[#fff5f7] px-4 py-2.5 text-sm text-destructive">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>{meError}</span>
            <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={retryMe}>
              Try again
            </Button>
          </div>
        </div>
      )}

      <main
        id="top"
        ref={mainRef}
        tabIndex={-1}
        className="flex-1 focus:outline-none focus-visible:outline-none"
      >
        {identityPending && (
          <section className="mx-auto max-w-3xl px-5 py-24 text-center" aria-live="polite">
            <p className="text-sm text-muted-foreground">Loading your session…</p>
          </section>
        )}

        {!identityPending && (
          <div className="route-in">
            {route === '/' && <LandingPage />}

            {route === '/studio' && (
              <StudioPage
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
                pipelineError={pipelineError}
                onRunPipeline={() => void runPipeline()}
              />
            )}

            {!isKnownRoute && <NotFoundPage />}
          </div>
        )}
      </main>

      <footer className="border-t border-border/80 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-7 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-6 shrink-0" />
            <span className="font-medium text-ink" translate="no">Well7 Research Lab</span>
          </div>
          <p>Synthetic Data Weekly &amp; Live Topic Search.</p>
        </div>
      </footer>
    </div>
  )
}
