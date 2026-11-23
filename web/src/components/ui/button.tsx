import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[background-color,border-color,box-shadow,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.99] [&_svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-[#faf4ec] shadow-xs hover:bg-[#092b2d] motion-safe:hover:-translate-y-px',
        amber: 'bg-[#b46319] text-[#fffdf9] shadow-xs hover:bg-[#965011] motion-safe:hover:-translate-y-px',
        secondary: 'bg-secondary text-ink hover:bg-[#ebdecb]',
        ink: 'bg-primary text-[#faf4ec] shadow-xs hover:bg-[#092b2d] motion-safe:hover:-translate-y-px',
        outline: 'border border-[#cebda5] bg-[#fffdf9] text-primary hover:border-primary hover:bg-secondary',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-primary',
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
