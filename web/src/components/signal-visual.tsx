import { Database, Radio, Waypoints } from 'lucide-react'

import { BackgroundBeams } from '@/components/ui/background-beams'
import { Badge } from '@/components/ui/badge'
import { NumberTicker } from '@/components/ui/number-ticker'

interface SignalVisualProps {
  itemCount: number
  sourceCount: number
  averageScore: number
}

const leftNodes = [
  [40, 38], [78, 62], [38, 98], [92, 118], [52, 152], [114, 82], [112, 154],
]
const rightNodes = [
  [250, 56], [286, 92], [248, 132], [306, 150],
]

export function SignalVisual({ itemCount, sourceCount, averageScore }: SignalVisualProps) {
  return (
    <div className="relative isolate overflow-hidden rounded-[28px] border border-white/10 bg-ink p-6 text-white shadow-[0_28px_80px_-32px_rgba(16,42,67,0.65)] sm:p-8">
      <BackgroundBeams className="opacity-35" />
      <div className="signal-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_80%)]" />

      <div className="relative z-10">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-sm font-medium text-white/85">
            <Radio className="size-4 text-[#a7f3d0]" aria-hidden="true" />
            Weekly signal map
          </div>
          <Badge className="border-white/15 bg-white/10 text-white" variant="outline">
            Live archive
          </Badge>
        </div>

        <div className="mt-8 grid items-center gap-6 sm:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/10 bg-[#0b2238]/75 p-4 backdrop-blur-sm">
            <svg viewBox="0 0 340 190" className="h-auto w-full" role="img" aria-label="Multiple research sources distilled into selected findings">
              <g stroke="rgba(167,243,208,.25)" strokeWidth="1">
                {leftNodes.map(([x, y], index) => {
                  const [rightX, rightY] = rightNodes[index % rightNodes.length]
                  return <line key={`line-${x}-${y}`} x1={x} y1={y} x2={rightX} y2={rightY} />
                })}
              </g>
              <g fill="#8b91ff">
                {leftNodes.map(([x, y]) => <circle key={`left-${x}-${y}`} cx={x} cy={y} r="4" />)}
              </g>
              <g fill="#a7f3d0">
                {rightNodes.map(([x, y]) => <circle key={`right-${x}-${y}`} cx={x} cy={y} r="6" />)}
              </g>
              <path d="M174 24V166" stroke="rgba(255,255,255,.12)" strokeDasharray="4 6" />
              <text x="36" y="180" fill="rgba(255,255,255,.68)" fontSize="11" fontFamily="IBM Plex Sans">Collected</text>
              <text x="248" y="180" fill="rgba(255,255,255,.68)" fontSize="11" fontFamily="IBM Plex Sans">Curated</text>
            </svg>
          </div>

          <div className="sm:pl-1">
            <p className="text-sm text-white/60">Average relevance</p>
            <div className="mt-1 flex items-end gap-2">
              <NumberTicker
                value={averageScore}
                decimalPlaces={1}
                className="font-display text-6xl font-medium tracking-[-0.05em] text-white"
              />
              <span className="pb-2 text-lg text-white/60">/ 10</span>
            </div>
            <p className="mt-3 max-w-48 text-sm leading-6 text-white/65">
              Scored for synthetic-data relevance and Well7 fit, then summarised from the full text of the source.
            </p>
          </div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-3 border-t border-white/10 pt-5">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/10 p-2.5"><Database className="size-4 text-[#a7f3d0]" aria-hidden="true" /></div>
            <div>
              <NumberTicker value={sourceCount} className="block text-xl font-semibold tracking-normal text-white" />
              <span className="text-xs text-white/65">Sources in brief</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/10 p-2.5"><Waypoints className="size-4 text-[#a7f3d0]" aria-hidden="true" /></div>
            <div>
              <NumberTicker value={itemCount} className="block text-xl font-semibold tracking-normal text-white" />
              <span className="text-xs text-white/65">Selected findings</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
