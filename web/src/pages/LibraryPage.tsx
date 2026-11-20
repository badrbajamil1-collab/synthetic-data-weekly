import { useClerk } from '@clerk/react'

import { Library } from '@/components/library'
import { Button } from '@/components/ui/button'
import { type LibraryBundle } from '@/lib/api'

/**
 * `/library` (signed in): read later, important marks, and notes across all
 * weeks, plus Upcoming — free-text entries about things not in a brief yet.
 */
export function LibraryPage({ signedIn, library }: { signedIn: boolean; library: LibraryBundle }) {
  const clerk = useClerk()

  if (!signedIn) {
    return (
      <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
        <div className="mb-10 max-w-2xl">
          <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl">
            Your saved library
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
            Read later, important marks, and notes across every week. Only you can see them.
          </p>
        </div>
        <div className="rounded-3xl border border-dashed border-border bg-white/80 px-6 py-14 text-center">
          <h2 className="font-display text-2xl font-medium text-ink">Sign in to build your library.</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Your Read later items, Important marks, and personal notes stay private to your account.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button variant="ink" onClick={() => clerk.openSignIn()}>Sign in</Button>
            <Button variant="outline" onClick={() => clerk.openSignUp()}>Create an account</Button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mx-auto max-w-7xl px-5 pb-20 pt-10 sm:px-8 sm:pt-14">
      <div className="mb-10 max-w-2xl">
        <h1 className="text-balance font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl">
          Your saved library
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Read later, important marks, and notes across every week. Only you can see them.
        </p>
      </div>

      <Library
        entries={library.entries}
        onToggle={library.togglePaper}
        onNote={library.saveNote}
        loading={library.loading}
        error={library.error}
        reload={library.reload}
      />
    </section>
  )
}
