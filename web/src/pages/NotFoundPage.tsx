import { FileText } from 'lucide-react'

import { Link } from '@/components/link'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-2xl px-5 pb-20 pt-14 sm:px-8 sm:pt-20">
      <div className="rounded-3xl border border-dashed border-input bg-[#fffdf9] px-6 py-12 text-center shadow-[0_6px_18px_rgba(14,62,64,0.05)] sm:px-10">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-secondary text-primary">
          <FileText className="size-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-balance font-display text-3xl font-medium tracking-[-0.02em] text-primary sm:text-4xl">
          This page does not exist.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground sm:text-base">
          The link may be outdated or mistyped. All published weekly briefs are available in the archive.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="default" asChild>
            <Link to="/">Back to home</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/archive">Open the archive</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
