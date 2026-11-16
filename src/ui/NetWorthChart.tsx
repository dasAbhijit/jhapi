import { useState } from 'react'
import { inRange, type Range, type Snapshot } from '../core/networth'
import { formatRupees } from '../core/money'

const RANGES: Range[] = ['1M', '3M', '6M', '1Y', 'FY', 'All']
const W = 340
const H = 64

/** Net worth over time from the script's daily snapshots, with the change over the chosen range. */
export function NetWorthChart({ snapshots, today }: { snapshots: Snapshot[]; today: string }) {
  const [range, setRange] = useState<Range>('1M')
  const pts = inRange(snapshots, range, today)
  const first = pts[0]
  const last = pts.at(-1)
  const change = first && last ? last.netPaise - first.netPaise : 0
  const pct = first && first.netPaise > 0 ? (change / first.netPaise) * 100 : null
  const min = Math.min(...pts.map((p) => p.netPaise))
  const max = Math.max(...pts.map((p) => p.netPaise))
  const span = max - min || 1
  const line = pts
    .map((p, i) => `${pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W},${(H - 4 - ((p.netPaise - min) / span) * (H - 8)).toFixed(1)}`)
    .join(' ')
  return (
    <div className="nw-chart">
      <div className="chip-row" role="radiogroup" aria-label="Time range">
        {RANGES.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={range === r} className="range-chip" onClick={() => setRange(r)}>
            {r}
          </button>
        ))}
      </div>
      {pts.length < 2 ? (
        <p className="row-sub">The chart fills in as the sheet saves your net worth each morning.</p>
      ) : (
        <>
          <p className={change < 0 ? 'nw-change neg' : 'nw-change'} aria-live="polite">
            {change >= 0 ? '+' : '−'}
            {formatRupees(Math.abs(change)).replace(/^−/, '')}
            {pct !== null ? ` (${change >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)` : ''} over {range === 'All' ? 'all time' : range === 'FY' ? 'this financial year' : range}
          </p>
          <svg viewBox={`0 0 ${W} ${H}`} className="nw-svg" role="img" aria-label={`Net worth from ${formatRupees(first!.netPaise)} to ${formatRupees(last!.netPaise)}`}>
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      )}
    </div>
  )
}
