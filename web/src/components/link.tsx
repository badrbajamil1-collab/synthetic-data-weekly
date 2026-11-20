import type { AnchorHTMLAttributes } from 'react'

import { navigate } from '@/lib/router'

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
}

export function Link({ to, onClick, target, download, ...rest }: LinkProps) {
  return (
    <a
      href={to}
      target={target}
      download={download}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (target && target !== '_self') return
        if (download !== undefined) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (to.startsWith('#')) return
        event.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}
