import { useEffect, useRef } from 'react'
import { ArrowDownToLine, X } from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import { Link } from '@/components/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface DrawerLink {
  to: string
  label: string
  highlight?: boolean
}

interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
  links: DrawerLink[]
  isActive: (path: string) => boolean
  signedIn: boolean
  latestPdfUrl?: string | null
  onSignUp: () => void
  onSignIn: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

/**
 * Native modal `<dialog>` mobile navigation drawer.
 * Uses `showModal()` so the browser makes outside content inert, traps focus in
 * the top layer, handles Escape via `cancel`, and restores focus to the menu button.
 */
export function MobileNavDrawer({
  open,
  onClose,
  links,
  isActive,
  signedIn,
  latestPdfUrl,
  onSignUp,
  onSignIn,
  triggerRef,
}: MobileNavDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef(true)

  function dismiss(restoreFocus = true) {
    restoreFocusRef.current = restoreFocus
    onClose()
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      restoreFocusRef.current = true
      dialog.showModal()
      closeBtnRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  // Close the modal `<dialog>` if the viewport crosses into desktop width so
  // `md:hidden` never leaves the desktop page inert behind a hidden modal.
  useEffect(() => {
    if (!open || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 768px)')
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        restoreFocusRef.current = false
        onClose()
      }
    }
    if (mq.matches) {
      handleChange(mq)
      return
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [open, onClose])

  return (
    <dialog
      ref={dialogRef}
      id="mobile-navigation"
      aria-label="Navigation menu"
      className="mobile-drawer md:hidden"
      onCancel={(event) => {
        event.preventDefault()
        dismiss(true)
      }}
      onClose={() => {
        const shouldRestore = restoreFocusRef.current
        restoreFocusRef.current = true
        if (shouldRestore) {
          triggerRef.current?.focus()
        }
      }}
      onClick={(event) => {
        if (sheetRef.current && !sheetRef.current.contains(event.target as Node)) {
          dismiss(true)
        }
      }}
    >
      <div ref={sheetRef} className="mobile-drawer-sheet">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <Link
            to="/"
            onClick={() => dismiss(false)}
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark className="size-8 shrink-0" />
            <span className="font-display text-base font-semibold text-primary" translate="no">
              Well7 Research Lab
            </span>
          </Link>
          <button
            ref={closeBtnRef}
            type="button"
            aria-label="Close navigation menu"
            onClick={() => dismiss(true)}
            className="grid size-11 cursor-pointer place-items-center rounded-full border border-input bg-[#fffdf9] text-primary transition-colors hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Mobile" className="flex flex-1 flex-col gap-1 p-4">
          <Link
            to="/"
            aria-current={isActive('/') ? 'page' : undefined}
            onClick={() => dismiss(false)}
            className={cn(
              'flex min-h-11 items-center justify-between rounded-xl px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive('/')
                ? 'bg-[#e1f0ee] font-semibold text-primary'
                : 'text-ink hover:bg-secondary',
            )}
          >
            Home
          </Link>
          {links.map((link) => {
            const active = isActive(link.to)
            return (
              <Link
                key={link.to}
                to={link.to}
                aria-current={active ? 'page' : undefined}
                onClick={() => dismiss(false)}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-[#e1f0ee] font-semibold text-primary'
                    : 'text-ink hover:bg-secondary',
                )}
              >
                {link.highlight && (
                  <span className="size-2 rounded-full bg-[#b46319]" aria-hidden="true" />
                )}
                {link.label}
              </Link>
            )
          })}

          {(latestPdfUrl || !signedIn) && (
            <div className="mt-auto flex flex-col gap-2.5 border-t border-border pt-4">
              {latestPdfUrl && (
                <Button size="lg" variant="outline" className="w-full" asChild>
                  <a
                    href={latestPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => dismiss(false)}
                  >
                    <ArrowDownToLine className="size-4" aria-hidden="true" />
                    Download PDF
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </Button>
              )}
              {!signedIn && (
                <>
                  <Button
                    size="lg"
                    variant="default"
                    className="w-full"
                    onClick={() => {
                      dismiss(false)
                      onSignIn()
                    }}
                  >
                    Sign in
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      dismiss(false)
                      onSignUp()
                    }}
                  >
                    Sign up
                  </Button>
                </>
              )}
            </div>
          )}
        </nav>
      </div>
    </dialog>
  )
}
