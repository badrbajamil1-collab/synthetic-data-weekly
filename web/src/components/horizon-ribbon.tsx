import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

interface HorizonRibbonProps {
  variant?: 'hero' | 'compact'
  className?: string
}

/**
 * Authored sunrise silk-ribbon canvas inside Horizon hero and brief banners.
 * Renders a static frame when `prefers-reduced-motion: reduce` is active.
 */
export function HorizonRibbon({ variant = 'hero', className }: HorizonRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef(0.6)
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const drawFrame = () => {
      const w = canvas.clientWidth || 960
      const h = canvas.clientHeight || (variant === 'compact' ? 180 : 340)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const targetW = Math.round(w * dpr)
      const targetH = Math.round(h * dpr)

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const glowRadius = Math.max(w * 0.36, 260)
      const glow = ctx.createRadialGradient(w * 0.74, h * 0.25, 10, w * 0.74, h * 0.25, glowRadius)
      glow.addColorStop(0, 'rgba(240, 194, 129, 0.22)')
      glow.addColorStop(0.55, 'rgba(125, 211, 199, 0.08)')
      glow.addColorStop(1, 'rgba(14, 62, 64, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      const phase = phaseRef.current
      const lines = variant === 'compact' ? 7 : 11
      const midIndex = Math.floor(lines / 2)
      for (let i = 0; i < lines; i += 1) {
        ctx.beginPath()
        const base = h * 0.16 + i * ((h * 0.75) / lines)
        for (let x = 0; x <= w; x += 6) {
          const u = x / w
          const y =
            base +
            Math.sin(u * 4.2 + phase * 0.7 + i * 0.35) * 22 +
            Math.cos(u * 2.1 - phase * 0.45 + i * 0.25) * 12
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(240, 194, 129, 0.24)' : 'rgba(125, 211, 199, 0.16)'
        ctx.lineWidth = i === midIndex ? 1.8 : 1.05
        ctx.stroke()
      }

      if (!reducedMotion) {
        phaseRef.current = phase + 0.012
        rafRef.current = window.requestAnimationFrame(drawFrame)
      }
    }

    drawFrame()

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (reducedMotion) drawFrame()
          })
        : null
    observer?.observe(canvas)

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      observer?.disconnect()
    }
  }, [variant])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full opacity-90', className)}
    />
  )
}
