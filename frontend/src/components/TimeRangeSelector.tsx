interface TimeRange {
  label: string
  minutes: number | null // null = all data
}

const RANGES: TimeRange[] = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '6h', minutes: 360 },
  { label: '24h', minutes: 1440 },
  { label: 'All', minutes: null },
]

interface Props {
  value: number | null
  onChange: (minutes: number | null) => void
}

export function TimeRangeSelector({ value, onChange }: Props) {
  return (
    <div className="time-range-selector">
      <span className="time-range-label">Time Range:</span>
      {RANGES.map((r) => (
        <button
          key={r.label}
          className={`time-range-btn ${value === r.minutes ? 'active' : ''}`}
          onClick={() => onChange(r.minutes)}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
