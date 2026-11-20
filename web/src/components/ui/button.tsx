import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[background-color,border-color,box-shadow,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.99] [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-[#115e59] motion-safe:hover:-translate-y-px',
        secondary: 'bg-secondary text-ink hover:bg-[#e2e8f0]',
        ink: 'bg-ink text-white shadow-xs hover:bg-ink/90 motion-safe:hover:-translate-y-px',
        outline: 'border border-border bg-white text-ink hover:border-primary/50 hover:text-primary',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-ink',
      },
      size: {
        default: 'min-h-10 px-5 py-2',
        sm: 'min-h-9 px-4 py-1.5 text-xs',
        lg: 'min-h-11 px-6 py-2.5',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button }
