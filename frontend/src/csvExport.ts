import type { ProfilerData } from './types'
import type { PanelId } from './components/FilterBar'

interface CsvExportOptions {
  data: ProfilerData
  hosts: string[]
  domains: string[]
  selectedInterface: string | null
  panels: Set<PanelId>
  showEvents: boolean
}

export function generateCsv(options: CsvExportOptions): string {
  const { data, hosts, domains, selectedInterface, panels, showEvents } = options
  const rows: string[] = ['timestamp,metric_type,target,value']

  const addSeries = (
    metric: string,
    series: Record<string, { x: string; y: number }[]> | undefined,
    targets: string[],
  ) => {
    if (!series) return
    for (const target of targets) {
      const points = series[target]
      if (!points) continue
      for (const p of points) {
        rows.push(`${p.x},${metric},${target},${p.y}`)
      }
    }
  }

  if (panels.has('latency')) addSeries('latency', data.latency, hosts)
  if (panels.has('packetLoss')) addSeries('packet_loss', data.loss, hosts)
  if (panels.has('jitter')) addSeries('jitter', data.jitter, hosts)
  if (panels.has('dns')) addSeries('dns', data.dns, domains)

  if (panels.has('throughput') && selectedInterface) {
    addSeries('throughput_down', data.tp_down, [selectedInterface])
    addSeries('throughput_up', data.tp_up, [selectedInterface])
  }

  if (showEvents && data.events_raw) {
    for (const ev of data.events_raw) {
      rows.push(`${ev.ts},event,${ev.kind},"${ev.detail.replace(/"/g, '""')}"`)
    }
  }

  return rows.join('\n')
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
