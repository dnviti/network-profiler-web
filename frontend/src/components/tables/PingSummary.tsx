import type { ProfilerData } from '../../types'

interface Props {
  data: ProfilerData
}

export function PingSummary({ data }: Props) {
  const hosts = data.hosts || []
  const ping = data.summary?.ping || {}

  return (
    <table>
      <thead>
        <tr>
          <th>Host</th>
          <th>Avg (ms)</th>
          <th>Min</th>
          <th>Max</th>
          <th>Jitter</th>
          <th>Loss</th>
          <th>Probes</th>
        </tr>
      </thead>
      <tbody>
        {hosts.map((host) => {
          const p = ping[host] || {}
          return (
            <tr key={host}>
              <td>{host}</td>
              <td>{p.avg ?? '\u2014'}</td>
              <td>{p.min ?? '\u2014'}</td>
              <td>{p.max ?? '\u2014'}</td>
              <td>{p.jitter ?? '\u2014'}</td>
              <td className={(p.loss_pct ?? 0) > 2 ? 'loss' : ''}>
                {p.loss_pct ?? '\u2014'}%
              </td>
              <td>{p.total ?? '\u2014'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
