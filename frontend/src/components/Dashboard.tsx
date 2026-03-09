import { useWebSocket } from '../hooks/useWebSocket'
import { StatCards } from './StatCards'
import { LatencyChart } from './charts/LatencyChart'
import { PacketLossChart } from './charts/PacketLossChart'
import { JitterChart } from './charts/JitterChart'
import { DnsChart } from './charts/DnsChart'
import { ThroughputChart } from './charts/ThroughputChart'
import { PingSummary } from './tables/PingSummary'
import { DnsSummary } from './tables/DnsSummary'

export function Dashboard() {
  const { data, connected } = useWebSocket()

  if (!data) {
    return (
      <div className="loading">
        <h1>Network Profiler Dashboard</h1>
        <p className="meta">Waiting for data...</p>
      </div>
    )
  }

  const updated = data.updated
    ? new Date(data.updated).toLocaleTimeString()
    : '\u2014'

  return (
    <div>
      <h1>Network Profiler Dashboard</h1>
      <p className="meta">
        <span className={`status ${connected ? '' : 'dead'}`} />
        Last updated: {updated}
      </p>

      <StatCards summary={data.summary!} />

      <div className="grid">
        <div className="card">
          <h2>Ping Latency (ms)</h2>
          <LatencyChart data={data} />
        </div>
        <div className="card">
          <h2>Packet Loss % (rolling 20)</h2>
          <PacketLossChart data={data} />
        </div>
        <div className="card">
          <h2>Jitter / Latency StdDev (ms, rolling 10)</h2>
          <JitterChart data={data} />
        </div>
        <div className="card">
          <h2>DNS Resolution (ms)</h2>
          <DnsChart data={data} />
        </div>
        <div className="card full">
          <h2>Throughput (kbps)</h2>
          <ThroughputChart data={data} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Ping Summary</h2>
        <PingSummary data={data} />
      </div>
      <div className="card">
        <h2>DNS Summary</h2>
        <DnsSummary data={data} />
      </div>
    </div>
  )
}
