const NOISE: Array<[number, number, number]> = [
  [10.9, 6.9, 1.6], [22.1, 8.2, 1.5], [6.8, 12.1, 1.5], [28.1, 12.8, 1.5],
  [17.3, 15.7, 1.6], [41.2, 16.1, 1.5], [23.4, 18.4, 1.3], [8.5, 19.5, 1.3],
  [41.2, 23.3, 1.4], [35, 26.6, 1.4], [7.8, 27.3, 1.6], [32.5, 34.9, 1.7],
  [41.4, 36, 1.4], [25.7, 38.5, 1.3], [19.2, 40.5, 1.7], [32.8, 41.4, 1.4],
]

interface BrandMarkProps {
  className?: string
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="12" fill="#102a43" />
      {NOISE.map(([cx, cy, r]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#4f6479" />
      ))}
      <polyline
        points="11,37 17,26 24,31 37,11"
        fill="none"
        stroke="#818cf8"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={11} cy={37} r={2.8} fill="#ffffff" />
      <circle cx={17} cy={26} r={2.8} fill="#ffffff" />
      <circle cx={24} cy={31} r={2.8} fill="#ffffff" />
      <circle cx={37} cy={11} r={3.4} fill="#5eead4" />
    </svg>
  )
}
