import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
}

export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const motionValue = useMotionValue(direction === "down" ? value : startValue)
  const springValue = useSpring(motionValue, {
    damping: 60,
    stiffness: 100,
  })
  const isInView = useInView(ref, { once: true, margin: "0px" })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null

    if (isInView && !shouldReduceMotion) {
      timer = setTimeout(() => {
        motionValue.set(direction === "down" ? startValue : value)
      }, delay * 1000)
    }

    return () => {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }, [motionValue, isInView, delay, value, direction, startValue, shouldReduceMotion])

  useEffect(
    () => {
      if (shouldReduceMotion) return
      return springValue.on("change", (latest) => {
        if (ref.current) {
          ref.current.textContent = Intl.NumberFormat(undefined, {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
          }).format(Number(latest.toFixed(decimalPlaces)))
        }
      })
    },
    [springValue, decimalPlaces, shouldReduceMotion]
  )

  return (
    <span
      ref={ref}
      className={cn(
        "inline-block tracking-wider text-ink tabular-nums",
        className
      )}
      {...props}
    >
      {shouldReduceMotion
        ? Intl.NumberFormat(undefined, {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces,
          }).format(value)
        : startValue}
    </span>
  )
}
