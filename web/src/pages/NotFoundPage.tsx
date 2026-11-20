import { FileText } from 'lucide-react'

import { Link } from '@/components/link'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 pb-20 pt-14 text-center sm:px-8 sm:pt-20">
      <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-balance font-display text-3xl font-medium tracking-[-0.03em] text-ink sm:text-4xl">
        This page does not exist.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
        The link may be outdated or mistyped. All published weekly briefs are available in the archive.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="ink" asChild>
          <Link to="/">Back to home</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/archive">Open the archive</Link>
        </Button>
      </div>
    </section>
  )
}
