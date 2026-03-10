import type { DataPoint } from './types'
import type uPlot from 'uplot'

export function formatTime(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Convert backend { host: [{x,y},...] } to uPlot AlignedData.
 * Returns [timestamps, series1, series2, ...] with aligned indices.
 * Timestamps are Unix seconds (what uPlot expects for time scales).
 */
export function toAlignedData(
  seriesMap: Record<string, DataPoint[]>,
  keys: string[],
): uPlot.AlignedData {
  // Collect all unique timestamps and sort
  const tsSet = new Set<string>()
  for (const key of keys) {
    const pts = seriesMap[key]
    if (pts) {
      for (const p of pts) tsSet.add(p.x)
    }
  }

  const sorted = Array.from(tsSet).sort()
  const timestamps = new Float64Array(sorted.length)
  const tsIndex = new Map<string, number>()

  for (let i = 0; i < sorted.length; i++) {
    timestamps[i] = new Date(sorted[i]).getTime() / 1000
    tsIndex.set(sorted[i], i)
  }

  const series: (number | null)[][] = []
  for (const key of keys) {
    const arr: (number | null)[] = new Array(sorted.length).fill(null)
    const pts = seriesMap[key]
    if (pts) {
      for (const p of pts) {
        const idx = tsIndex.get(p.x)
        if (idx !== undefined) arr[idx] = p.y
      }
    }
    series.push(arr)
  }

  return [timestamps, ...series] as uPlot.AlignedData
}

/**
 * Convert throughput down/up arrays to uPlot AlignedData.
 * Returns [timestamps, download, upload].
 */
export function toThroughputData(
  down: DataPoint[],
  up: DataPoint[],
): uPlot.AlignedData {
  const tsSet = new Set<string>()
  for (const p of down) tsSet.add(p.x)
  for (const p of up) tsSet.add(p.x)

  const sorted = Array.from(tsSet).sort()
  const timestamps = new Float64Array(sorted.length)
  const tsIndex = new Map<string, number>()

  for (let i = 0; i < sorted.length; i++) {
    timestamps[i] = new Date(sorted[i]).getTime() / 1000
    tsIndex.set(sorted[i], i)
  }

  const dlArr: (number | null)[] = new Array(sorted.length).fill(null)
  const ulArr: (number | null)[] = new Array(sorted.length).fill(null)

  for (const p of down) {
    const idx = tsIndex.get(p.x)
    if (idx !== undefined) dlArr[idx] = p.y
  }
  for (const p of up) {
    const idx = tsIndex.get(p.x)
    if (idx !== undefined) ulArr[idx] = p.y
  }

  return [timestamps, dlArr, ulArr] as uPlot.AlignedData
}
