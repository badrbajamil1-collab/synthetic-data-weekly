import { useClerk } from '@clerk/react'

import { Library } from '@/components/library'
import { Button } from '@/components/ui/button'
import { type LibraryBundle } from '@/lib/api'

/**
 * `/library` (spec, signed in): read later / important / notes across all
 * weeks, plus Upcoming — free-text entries about things not in a brief yet.
 */
export function LibraryPage({ signedIn, library }: { signedIn: boolean; library: LibraryBundle }) {
  const clerk = useClerk()

  if (!signedIn) {
    return (
      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="mb-10 max-w-2xl">
          <p className="text-sm font-semibold text-primary">My library</p>
          <h1 className="mt-3 text-balance font-display text-4xl font-medium tracking-[-0.03em]">Papers you saved.</h1>
          <p className="mt-4 leading-7 text-muted-foreground">
            Read later, important marks and notes across every week. Only you can see them.
          </p>
        </div>
        <div className="rounded-3xl border border-dashed border-border bg-white/70 px-6 py-14 text-center">
          <p className="font-display text-2xl">Sign in to build your library.</p>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">
            Your Read later, Important marks and notes stay private to your account.
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
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mb-10 max-w-2xl">
        <p className="text-sm font-semibold text-primary">My library</p>
        <h1 className="mt-3 text-balance font-display text-4xl font-medium tracking-[-0.03em]">Papers you saved.</h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          Read later, important marks and notes across every week. Only you can see them.
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
