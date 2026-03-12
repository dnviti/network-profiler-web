import { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react'
import { generateCsv, downloadCsv } from '../csvExport'
import { useWebSocket } from '../hooks/useWebSocket'
import { StatCards } from './StatCards'
import { TimeRangeSelector } from './TimeRangeSelector'
import { GlobalStats } from './GlobalStats'
import { FilterBar, ALL_PANELS } from './FilterBar'
import type { PanelId } from './FilterBar'

const LatencyChart = lazy(() => import('./charts/LatencyChart').then((m) => ({ default: m.LatencyChart })))
const PacketLossChart = lazy(() => import('./charts/PacketLossChart').then((m) => ({ default: m.PacketLossChart })))
const JitterChart = lazy(() => import('./charts/JitterChart').then((m) => ({ default: m.JitterChart })))
const DnsChart = lazy(() => import('./charts/DnsChart').then((m) => ({ default: m.DnsChart })))
const ThroughputChart = lazy(() => import('./charts/ThroughputChart').then((m) => ({ default: m.ThroughputChart })))
const PingSummary = lazy(() => import('./tables/PingSummary').then((m) => ({ default: m.PingSummary })))
const DnsSummary = lazy(() => import('./tables/DnsSummary').then((m) => ({ default: m.DnsSummary })))

const DEFAULT_PANELS = new Set<PanelId>(ALL_PANELS.map((p) => p.id))

export function Dashboard() {
  const { data, connected, minutes, setMinutes } = useWebSocket()

  /* --- event markers visibility --- */
  const [showEvents, setShowEvents] = useState(true)

  /* --- panel visibility --- */
  const [panels, setPanels] = useState<Set<PanelId>>(DEFAULT_PANELS)
  const togglePanel = useCallback((id: PanelId) => {
    setPanels((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /* --- host visibility (initialised from first data) --- */
  const [visibleHosts, setVisibleHosts] = useState<Set<string> | null>(null)
  const hostsInited = useRef(false)
  const allHosts = data?.hosts ?? []

  useEffect(() => {
    if (allHosts.length > 0 && !hostsInited.current) {
      setVisibleHosts(new Set(allHosts))
      hostsInited.current = true
    }
  }, [allHosts])

  const toggleHost = useCallback((host: string) => {
    setVisibleHosts((prev) => {
      if (!prev) return prev
      const next = new Set(prev)
      if (next.has(host)) next.delete(host)
      else next.add(host)
      return next
    })
  }, [])

  /* --- domain visibility (initialised from first data) --- */
  const [visibleDomains, setVisibleDomains] = useState<Set<string> | null>(null)
  const domainsInited = useRef(false)
  const allDomains = data?.domains ?? []

  useEffect(() => {
    if (allDomains.length > 0 && !domainsInited.current) {
      setVisibleDomains(new Set(allDomains))
      domainsInited.current = true
    }
  }, [allDomains])

  const toggleDomain = useCallback((domain: string) => {
    setVisibleDomains((prev) => {
      if (!prev) return prev
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }, [])

  /* --- interface visibility --- */
  const [selectedInterface, setSelectedInterface] = useState<string | null>(null)
  const interfacesInited = useRef(false)
  const allInterfaces = data?.interfaces ?? []

  useEffect(() => {
    if (allInterfaces.length > 0 && !interfacesInited.current) {
      setSelectedInterface(allInterfaces[0])
      interfacesInited.current = true
    }
  }, [allInterfaces])

  /* --- CSV download --- */
  const handleDownloadCsv = useCallback(() => {
    if (!data) return
    const csv = generateCsv({
      data,
      hosts: allHosts.filter((h) => visibleHosts?.has(h) ?? true),
      domains: allDomains.filter((d) => visibleDomains?.has(d) ?? true),
      selectedInterface,
      panels,
      showEvents,
    })
    const rangeLabel = minutes != null ? `${minutes}m` : 'all'
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    downloadCsv(csv, `network-profiler-${rangeLabel}-${ts}.csv`)
  }, [data, allHosts, visibleHosts, allDomains, visibleDomains, selectedInterface, panels, showEvents, minutes])

  /* --- loading state --- */
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

  const filteredHosts = allHosts.filter((h) => visibleHosts?.has(h) ?? true)
  const filteredDomains = allDomains.filter((d) => visibleDomains?.has(d) ?? true)

  const show = (id: PanelId) => panels.has(id)

  return (
    <div>
      <div className="dashboard-header">
        <div>
          <h1>Network Profiler Dashboard</h1>
          <p className="meta">
            <span className={`status ${connected ? '' : 'dead'}`} />
            Last updated: {updated}
          </p>
        </div>
        <div className="header-controls">
          <button className="csv-download-btn" onClick={handleDownloadCsv}>Download CSV</button>
          <GlobalStats />
          <TimeRangeSelector value={minutes} onChange={setMinutes} />
        </div>
      </div>

      <FilterBar
        panels={panels}
        onTogglePanel={togglePanel}
        showEvents={showEvents}
        onToggleEvents={() => setShowEvents((v) => !v)}
        hosts={allHosts}
        visibleHosts={visibleHosts ?? new Set(allHosts)}
        onToggleHost={toggleHost}
        domains={allDomains}
        visibleDomains={visibleDomains ?? new Set(allDomains)}
        onToggleDomain={toggleDomain}
        interfaces={allInterfaces}
        selectedInterface={selectedInterface}
        onSelectInterface={setSelectedInterface}
      />

      <StatCards summary={data.summary!} selectedInterface={selectedInterface} />

      <Suspense fallback={<div style={{ minHeight: 260 }} />}>
        <div className="grid">
          {show('latency') && (
            <div className="card">
              <h2>Ping Latency (ms)</h2>
              <LatencyChart data={data} hosts={filteredHosts} showEvents={showEvents} />
            </div>
          )}
          {show('packetLoss') && (
            <div className="card">
              <h2>Packet Loss % (rolling 20)</h2>
              <PacketLossChart data={data} hosts={filteredHosts} showEvents={showEvents} />
            </div>
          )}
          {show('jitter') && (
            <div className="card">
              <h2>Jitter / Latency StdDev (ms, rolling 10)</h2>
              <JitterChart data={data} hosts={filteredHosts} showEvents={showEvents} />
            </div>
          )}
          {show('dns') && (
            <div className="card">
              <h2>DNS Resolution (ms)</h2>
              <DnsChart data={data} domains={filteredDomains} />
            </div>
          )}
          {show('throughput') && selectedInterface && (
            <div className="card full">
              <h2>Throughput (kbps)</h2>
              <ThroughputChart data={data} selectedInterface={selectedInterface} />
            </div>
          )}
        </div>

        {show('pingSummary') && (
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Ping Summary</h2>
            <PingSummary data={data} hosts={filteredHosts} />
          </div>
        )}
        {show('dnsSummary') && (
          <div className="card">
            <h2>DNS Summary</h2>
            <DnsSummary data={data} domains={filteredDomains} />
          </div>
        )}
      </Suspense>
    </div>
  )
}
