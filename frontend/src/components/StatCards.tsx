import type { Summary, ThroughputSummary } from '../types'

interface Props {
  summary: Summary
}

function hasThroughput(
  tp: ThroughputSummary | Record<string, never>,
): tp is ThroughputSummary {
  return 'duration_s' in tp
}

export function StatCards({ summary }: Props) {
  const ev = summary.events
  const tp = hasThroughput(summary.throughput) ? summary.throughput : null

  const cards = [
    {
      label: 'Disconnections',
      value: ev.disconnections,
      cls: ev.disconnections > 0 ? 'bad' : '',
    },
    { label: 'Reconnections', value: ev.reconnections, cls: '' },
    { label: 'Avg Down (kbps)', value: tp?.avg_down_kbps ?? '\u2014', cls: '' },
    { label: 'Avg Up (kbps)', value: tp?.avg_up_kbps ?? '\u2014', cls: '' },
    {
      label: 'Packets Dropped (in)',
      value: tp?.total_dropin ?? '\u2014',
      cls: (tp?.total_dropin ?? 0) > 0 ? 'warn' : '',
    },
    {
      label: 'Packets Dropped (out)',
      value: tp?.total_dropout ?? '\u2014',
      cls: (tp?.total_dropout ?? 0) > 0 ? 'warn' : '',
    },
    { label: 'Monitoring (sec)', value: tp?.duration_s ?? '\u2014', cls: '' },
  ]

  return (
    <div className="stat-grid">
      {cards.map((c) => (
        <div key={c.label} className={`stat ${c.cls}`}>
          <div className="val">{c.value}</div>
          <div className="lbl">{c.label}</div>
        </div>
      ))}
    </div>
  )
}
