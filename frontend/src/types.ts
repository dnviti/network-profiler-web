export interface DataPoint {
  x: string
  y: number
}

export interface PingSummaryEntry {
  total: number
  lost: number
  loss_pct: number
  min?: number
  max?: number
  avg?: number
  median?: number
  stdev?: number
  jitter?: number
}

export interface DnsSummaryEntry {
  total: number
  failed: number
  avg?: number
  max?: number
}

export interface ThroughputSummary {
  duration_s: number
  avg_down_kbps: number
  avg_up_kbps: number
  total_dropin: number
  total_dropout: number
  total_errin: number
  total_errout: number
}

export interface EventsSummary {
  disconnections: number
  reconnections: number
}

export interface Summary {
  ping: Record<string, PingSummaryEntry>
  dns: Record<string, DnsSummaryEntry>
  throughput: Record<string, ThroughputSummary>
  events: EventsSummary
}

export interface NetworkEvent {
  ts: string
  kind: string
  detail: string
}

export interface GlobalPingEntry {
  total: number
  lost: number
  loss_pct: number
  min: number | null
  max: number | null
  avg: number | null
}

export interface GlobalDnsEntry {
  total: number
  failed: number
  avg: number | null
  min: number | null
  max: number | null
}

export interface GlobalSummary {
  empty: boolean
  updated?: string
  first_ts?: string
  last_ts?: string
  hosts?: string[]
  domains?: string[]
  interfaces?: string[]
  ping?: Record<string, GlobalPingEntry>
  dns?: Record<string, GlobalDnsEntry>
  throughput?: Record<string, ThroughputSummary>
  events?: EventsSummary
}

export interface ProfilerData {
  empty: boolean
  updated?: string
  hosts?: string[]
  domains?: string[]
  interfaces?: string[]
  colors?: string[]
  latency?: Record<string, DataPoint[]>
  loss?: Record<string, DataPoint[]>
  jitter?: Record<string, DataPoint[]>
  dns?: Record<string, DataPoint[]>
  tp_down?: Record<string, DataPoint[]>
  tp_up?: Record<string, DataPoint[]>
  annotations?: unknown[]
  events_raw?: NetworkEvent[]
  summary?: Summary
}
