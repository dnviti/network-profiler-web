import type { DataPoint } from './types'

export function formatTime(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Convert backend's column-oriented data to Recharts' row-oriented format.
 * Backend: { host1: [{x, y}, ...], host2: [{x, y}, ...] }
 * Recharts: [{ time: "...", host1: 1.2, host2: 3.4 }, ...]
 */
export function mergeByTimestamp(
  seriesMap: Record<string, DataPoint[]>,
  keys: string[],
): Record<string, unknown>[] {
  const timeMap = new Map<string, Record<string, unknown>>()

  for (const key of keys) {
    const points = seriesMap[key] || []
    for (const p of points) {
      if (!timeMap.has(p.x)) {
        timeMap.set(p.x, { time: p.x })
      }
      timeMap.get(p.x)![key] = p.y
    }
  }

  return Array.from(timeMap.values()).sort(
    (a, b) =>
      new Date(a.time as string).getTime() -
      new Date(b.time as string).getTime(),
  )
}

export function mergeThroughput(
  down: DataPoint[],
  up: DataPoint[],
): Record<string, unknown>[] {
  const timeMap = new Map<string, Record<string, unknown>>()

  for (const p of down) {
    if (!timeMap.has(p.x)) timeMap.set(p.x, { time: p.x })
    timeMap.get(p.x)!.download = p.y
  }
  for (const p of up) {
    if (!timeMap.has(p.x)) timeMap.set(p.x, { time: p.x })
    timeMap.get(p.x)!.upload = p.y
  }

  return Array.from(timeMap.values()).sort(
    (a, b) =>
      new Date(a.time as string).getTime() -
      new Date(b.time as string).getTime(),
  )
}
