import type { ProfilerData } from '../../types'

interface Props {
  data: ProfilerData
}

export function DnsSummary({ data }: Props) {
  const domains = data.domains || []
  const dns = data.summary?.dns || {}

  return (
    <table>
      <thead>
        <tr>
          <th>Domain</th>
          <th>Avg (ms)</th>
          <th>Max (ms)</th>
          <th>Failures</th>
        </tr>
      </thead>
      <tbody>
        {domains.map((domain) => {
          const d = dns[domain] || {}
          return (
            <tr key={domain}>
              <td>{domain}</td>
              <td>{d.avg ?? '\u2014'}</td>
              <td>{d.max ?? '\u2014'}</td>
              <td>
                {d.failed ?? 0}/{d.total ?? 0}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
