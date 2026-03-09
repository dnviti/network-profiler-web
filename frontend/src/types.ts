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
  throughput: ThroughputSummary | Record<string, never>
  events: EventsSummary
}

export interface NetworkEvent {
  ts: string
  kind: string
  detail: string
}

export interface ProfilerData {
  empty: boolean
  updated?: string
  hosts?: string[]
  domains?: string[]
  colors?: string[]
  latency?: Record<string, DataPoint[]>
  loss?: Record<string, DataPoint[]>
  jitter?: Record<string, DataPoint[]>
  dns?: Record<string, DataPoint[]>
  tp_down?: DataPoint[]
  tp_up?: DataPoint[]
  annotations?: unknown[]
  events_raw?: NetworkEvent[]
  summary?: Summary
}
