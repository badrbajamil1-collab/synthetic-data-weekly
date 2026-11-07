import { FileText } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Link } from '@/lib/router'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
      <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-balance font-display text-4xl font-medium tracking-[-0.03em] text-ink">
        This page does not exist.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-muted-foreground">
        The link is old or mistyped. The briefs all live in the archive.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button variant="ink" asChild>
          <Link to="/">Back to the start</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/archive">Open the archive</Link>
        </Button>
      </div>
    </section>
  )
}
