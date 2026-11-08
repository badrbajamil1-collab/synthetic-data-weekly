import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Show, UserButton, useAuth, useClerk } from '@clerk/react'
import { CircleAlert } from 'lucide-react'

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
import { sortFollows, type TopicFollow, type TopicKind } from '@/lib/topics'
import { ArchivePage } from '@/pages/ArchivePage'
import { BriefPage } from '@/pages/BriefPage'
import { FeedPage } from '@/pages/FeedPage'
import { LandingPage } from '@/pages/LandingPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

/**
 * Router outlet + header/footer (spec `2026-11-06`, "Components"). The shell
 * owns the signed-in state (identity, follows, library, pipeline run); pages
 * consume it through props.
 */

/** Signed out: logo → /, links Brief + Archive, Sign in / Sign up. */
/** Signed in: logo → /library, links Feed + Brief + Library + Archive, avatar. */

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The archive could not be loaded. Try again.'
}

interface NavLinkProps {
  to: string
  active: boolean
  className?: string
  children: string
}

function NavLink({ to, active, className, children }: NavLinkProps) {
  return (
    <Button variant="ghost" size="sm" className={className ?? undefined} asChild>
      <Link to={to} aria-current={active ? 'page' : undefined} className={active ? 'bg-secondary/70 text-ink' : undefined}>
        {children}
      </Link>
    </Button>
  )
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

  // Clerk session → every signed-in request carries a fresh session JWT.
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

  // /api/me follows the Clerk session: signing in or out re-keys the identity,
  // re-loads (or clears) the private library and the followed topics. Library
  // loading is independent of /api/me (the endpoint verifies its own token),
  // so a failed /api/me never strands the library; it only degrades the
  // topics/isAdmin extras and surfaces here with a retry — the pages never
  // mistake it for being signed out.
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
    // Optimistic: the star and the feed narrow on the same frame as the click,
    // so a slow Worker round-trip never reads as "the star does nothing".
    const before = topics
    setTopics(
      sortFollows(
        next
          ? [...before.filter((follow) => !(follow.kind === kind && follow.value === value)), { kind, value }]
          : before.filter((follow) => !(follow.kind === kind && follow.value === value)),
      ),
    )
    try {
      const updated = next ? await putTopic({ kind, value }) : await deleteTopic({ kind, value })
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

  // Signed-in is Clerk's judgment (userId), not /api/me's success — a failed
  // identity fetch must not turn a signed-in feed into a sign-in prompt.
  const signedIn = Boolean(userId)
  const active = (path: string) => route === path || (path !== '/' && route.startsWith(path))
  const briefWeek = route.match(/^\/brief\/([^/]+)$/)?.[1]
  // Only the identity-dependent pages wait for the /api/me handshake; public
  // routes render immediately with signed-in extras arriving afterwards.
  const needsIdentity = route === '/feed' || route === '/library'
  const identityPending = !isLoaded || (needsIdentity && !sessionChecked)

  // Route change resets the scroll (history.pushState does not) — but not on
  // first mount, which would fight browser scroll restoration and anchors.
  const firstRouteRef = useRef(true)
  const mainRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (firstRouteRef.current) {
      firstRouteRef.current = false
      return
    }
    window.scrollTo(0, 0)
    // Keyboard and screen-reader users land at the new page's content.
    mainRef.current?.focus({ preventScroll: true })
  }, [route])

  return (
    <div className="min-h-screen overflow-x-clip bg-background text-ink">
      <a
        href="#top"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-5 focus-visible:top-3 focus-visible:z-[60] focus-visible:rounded-lg focus-visible:bg-white focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-ink focus-visible:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-50 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 sm:px-8">
          <Link to={signedIn ? '/library' : '/'} className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3">
            <BrandMark className="size-10 shrink-0 sm:size-11" />
            <span className="whitespace-nowrap">
              <span className="block font-display text-base font-semibold leading-tight sm:text-lg" translate="no">Well7 Research Lab</span>
              <span className="hidden text-xs text-muted-foreground sm:block">Synthetic Data Weekly</span>
            </span>
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
            <Show when="signed-in">
              <span className="flex items-center gap-0.5 sm:gap-1.5">
                <NavLink to="/feed" active={active('/feed')}>Feed</NavLink>
                <NavLink to="/brief" active={active('/brief')}>Brief</NavLink>
                <NavLink to="/library" active={active('/library')}>Library</NavLink>
                <NavLink to="/archive" active={active('/archive')}>Archive</NavLink>
              </span>
            </Show>
            <Show when="signed-out">
              <span className="flex items-center gap-0.5 sm:gap-1.5">
                <NavLink to="/brief" active={active('/brief')}>Brief</NavLink>
                <NavLink to="/archive" active={active('/archive')}>Archive</NavLink>
              </span>
            </Show>
            <Show when="signed-in">
              {me?.email && (
                <span className="hidden max-w-44 truncate text-xs text-muted-foreground lg:block">{me.email}</span>
              )}
              <UserButton />
            </Show>
            <Show when="signed-out">
              <Button variant="ghost" size="sm" onClick={() => clerk.openSignUp()}>Sign up</Button>
              <Button variant="ink" size="sm" onClick={() => clerk.openSignIn()}>Sign in</Button>
            </Show>
          </nav>
        </div>
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
            {route === '/' && <LandingPage />}

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

            {route !== '/' && route !== '/brief' && !route.startsWith('/brief/') && route !== '/feed' && route !== '/library' && route !== '/archive' && (
              <NotFoundPage />
            )}
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

      <footer className="border-t border-border bg-white/55">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="size-6 shrink-0" />
            <span className="font-semibold text-ink" translate="no">Well7 Research Lab</span>
          </div>
          <p>Well7 Research Lab · Collected and ranked every Saturday.</p>
        </div>
      </footer>
    </div>
  )
}
