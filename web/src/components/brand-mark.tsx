import { useId } from 'react'

interface BrandMarkProps {
  className?: string
}

export function BrandMark({ className }: BrandMarkProps) {
  const gradId = useId()
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradId} x1="12" y1="12" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E6A14D" />
          <stop offset="100%" stopColor="#B46319" />
        </linearGradient>
      </defs>
      <circle cx={24} cy={24} r={21} fill="rgba(180, 99, 25, 0.18)" />
      <circle cx={24} cy={24} r={15} fill={`url(#${gradId})`} />
    </svg>
  )
}
