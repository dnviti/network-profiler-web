import { useState, useCallback, useEffect } from 'react'
import type { GlobalSummary, ThroughputSummary } from '../types'

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatTs(iso: string | undefined): string {
  if (!iso) return '\u2014'
  const d = new Date(iso)
  return d.toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function GlobalStats() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<GlobalSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedInterface, setSelectedInterface] = useState<string | null>(null)

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/summary')
      const d: GlobalSummary = await r.json()
      setData(d)
      if (d.interfaces && d.interfaces.length > 0) {
        setSelectedInterface((prev) => prev && d.interfaces!.includes(prev) ? prev : d.interfaces![0])
      }
    } catch {
      setError('Failed to fetch global statistics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) fetchSummary()
  }, [open, fetchSummary])

  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => setOpen(false), [])

  if (!open) {
    return (
      <button className="global-stats-btn" onClick={handleOpen}>
        Global Stats
      </button>
    )
  }

  const tp = selectedInterface && data?.throughput && data.throughput[selectedInterface]
    ? data.throughput[selectedInterface]
    : null
  const ev = data?.events
  const hosts = data?.hosts ?? []
  const domains = data?.domains ?? []
  const ping = data?.ping ?? {}
  const dns = data?.dns ?? {}

  return (
    <>
      <div className="overlay-backdrop" onClick={handleClose} />
      <div className="overlay-panel">
        <div className="overlay-header">
          <h2>Global Statistics (All Time)</h2>
          <button className="overlay-close" onClick={handleClose}>&times;</button>
        </div>

        {loading && <p className="overlay-loading">Loading...</p>}
        {error && <p className="overlay-error">{error}</p>}
        {data && data.empty && <p className="overlay-loading">No data collected yet.</p>}

        {data && !data.empty && !loading && (
          <div className="overlay-body">
            {/* Time span */}
            <div className="gs-section">
              <h3>Monitoring Period</h3>
              <div className="gs-kv-grid">
                <div className="gs-kv"><span className="gs-label">From</span><span className="gs-value">{formatTs(data.first_ts)}</span></div>
                <div className="gs-kv"><span className="gs-label">To</span><span className="gs-value">{formatTs(data.last_ts)}</span></div>
                <div className="gs-kv"><span className="gs-label">Duration</span><span className="gs-value">{tp ? formatDuration(tp.duration_s) : '\u2014'}</span></div>
              </div>
            </div>

            {/* Events */}
            <div className="gs-section">
              <h3>Events</h3>
              <div className="gs-kv-grid">
                <div className="gs-kv">
                  <span className="gs-label">Disconnections</span>
                  <span className={`gs-value ${(ev?.disconnections ?? 0) > 0 ? 'gs-bad' : ''}`}>{ev?.disconnections ?? 0}</span>
                </div>
                <div className="gs-kv">
                  <span className="gs-label">Reconnections</span>
                  <span className="gs-value">{ev?.reconnections ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Throughput */}
            {tp && (
              <div className="gs-section">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0 }}>Throughput</h3>
                  {data.interfaces && data.interfaces.length > 1 && (
                    <select
                      value={selectedInterface || ''}
                      onChange={(e) => setSelectedInterface(e.target.value)}
                      style={{
                        background: '#334155',
                        color: '#fff',
                        border: 'none',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.85rem'
                      }}
                    >
                      {data.interfaces.map(iface => (
                        <option key={iface} value={iface}>{iface}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="gs-kv-grid">
                  <div className="gs-kv"><span className="gs-label">Avg Download</span><span className="gs-value">{tp.avg_down_kbps} kbps</span></div>
                  <div className="gs-kv"><span className="gs-label">Avg Upload</span><span className="gs-value">{tp.avg_up_kbps} kbps</span></div>
                  <div className="gs-kv">
                    <span className="gs-label">Dropped In</span>
                    <span className={`gs-value ${tp.total_dropin > 0 ? 'gs-warn' : ''}`}>{tp.total_dropin}</span>
                  </div>
                  <div className="gs-kv">
                    <span className="gs-label">Dropped Out</span>
                    <span className={`gs-value ${tp.total_dropout > 0 ? 'gs-warn' : ''}`}>{tp.total_dropout}</span>
                  </div>
                  <div className="gs-kv">
                    <span className="gs-label">Errors In</span>
                    <span className={`gs-value ${tp.total_errin > 0 ? 'gs-warn' : ''}`}>{tp.total_errin}</span>
                  </div>
                  <div className="gs-kv">
                    <span className="gs-label">Errors Out</span>
                    <span className={`gs-value ${tp.total_errout > 0 ? 'gs-warn' : ''}`}>{tp.total_errout}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Ping per host */}
            {hosts.length > 0 && (
              <div className="gs-section">
                <h3>Ping per Host</h3>
                <table className="gs-table">
                  <thead>
                    <tr>
                      <th>Host</th>
                      <th>Avg</th>
                      <th>Min</th>
                      <th>Max</th>
                      <th>Loss %</th>
                      <th>Probes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.map((h) => {
                      const p = ping[h]
                      if (!p) return null
                      return (
                        <tr key={h}>
                          <td>{h}</td>
                          <td>{p.avg ?? '\u2014'}</td>
                          <td>{p.min ?? '\u2014'}</td>
                          <td>{p.max ?? '\u2014'}</td>
                          <td className={(p.loss_pct ?? 0) > 2 ? 'loss' : ''}>{p.loss_pct}%</td>
                          <td>{p.total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* DNS per domain */}
            {domains.length > 0 && (
              <div className="gs-section">
                <h3>DNS per Domain</h3>
                <table className="gs-table">
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Avg</th>
                      <th>Min</th>
                      <th>Max</th>
                      <th>Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {domains.map((d) => {
                      const dn = dns[d]
                      if (!dn) return null
                      return (
                        <tr key={d}>
                          <td>{d}</td>
                          <td>{dn.avg ?? '\u2014'}</td>
                          <td>{dn.min ?? '\u2014'}</td>
                          <td>{dn.max ?? '\u2014'}</td>
                          <td>{dn.failed}/{dn.total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
