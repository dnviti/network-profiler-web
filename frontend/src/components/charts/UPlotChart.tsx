import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

/* ------------------------------------------------------------------ */
/*  Lazy-loading wrapper around uPlot with pan, zoom, and resize      */
/* ------------------------------------------------------------------ */

interface Props {
  options: Omit<uPlot.Options, 'width' | 'height'>
  data: uPlot.AlignedData
  height?: number
}

export function UPlotChart({ options, data, height = 260 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<uPlot | null>(null)
  const [visible, setVisible] = useState(false)

  // Persist zoom/pan state across chart re-creation so the user's
  // viewport survives options/series changes (like a stock chart).
  const savedScaleRef = useRef<{ min: number; max: number } | null>(null)
  const wasZoomedRef = useRef(false)

  /* --- IntersectionObserver: only mount uPlot when scrolled into view --- */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* --- Create / destroy uPlot instance --- */
  useEffect(() => {
    if (!visible || !containerRef.current) return

    const el = containerRef.current
    const width = el.clientWidth || 400

    const chart = new uPlot(
      { ...options, width, height } as uPlot.Options,
      data,
      el,
    )
    chartRef.current = chart

    // Restore zoom/pan state from previous instance
    if (wasZoomedRef.current && savedScaleRef.current) {
      _zoomed.add(chart)
      chart.setScale('x', savedScaleRef.current)
    }

    return () => {
      // Save zoom/pan state before destroying
      if (_zoomed.has(chart)) {
        wasZoomedRef.current = true
        const xMin = chart.scales.x.min
        const xMax = chart.scales.x.max
        if (xMin != null && xMax != null) {
          savedScaleRef.current = { min: xMin, max: xMax }
        }
      }
      chart.destroy()
      chartRef.current = null
    }
    // Re-create when options identity changes (series list changed etc.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, options, height])

  /* --- Update data without re-creating the chart --- */
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    if (_zoomed.has(chart)) {
      // User has zoomed/panned: preserve their current x-axis view
      const xMin = chart.scales.x.min
      const xMax = chart.scales.x.max
      chart.setData(data, false)
      if (xMin != null && xMax != null) {
        chart.setScale('x', { min: xMin, max: xMax })
        // Keep saved state in sync so re-creation also preserves it
        savedScaleRef.current = { min: xMin, max: xMax }
        wasZoomedRef.current = true
      }
    } else {
      // No user interaction: auto-range to show all data
      chart.setData(data, true)
      // Clear saved state so re-creation also auto-ranges
      savedScaleRef.current = null
      wasZoomedRef.current = false
    }
  }, [data])

  /* --- ResizeObserver --- */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver(() => {
      const chart = chartRef.current
      if (chart) chart.setSize({ width: el.clientWidth, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minHeight: height }}
    />
  )
}

/* ------------------------------------------------------------------ */
/*  Shared zoom state: tracks which uPlot instances have been         */
/*  manually zoomed/panned by the user.                               */
/* ------------------------------------------------------------------ */

const _zoomed = new WeakSet<uPlot>()

/* ------------------------------------------------------------------ */
/*  Wheel-zoom + drag-pan plugin (adapted from uPlot demos)           */
/* ------------------------------------------------------------------ */

export function wheelZoomPlugin(): uPlot.Plugin {
  return {
    hooks: {
      ready(u: uPlot) {
        const over = u.over
        const xMin = () => u.scales.x.min!
        const xMax = () => u.scales.x.max!

        // Wheel: zoom x-axis
        over.addEventListener('wheel', (e: WheelEvent) => {
          e.preventDefault()
          _zoomed.add(u)
          const { left, width } = over.getBoundingClientRect()
          const cursor = (e.clientX - left) / width
          const range = xMax() - xMin()
          const factor = e.deltaY > 0 ? 1.25 : 0.8
          const newRange = range * factor
          const delta = newRange - range
          const nMin = xMin() - delta * cursor
          const nMax = xMax() + delta * (1 - cursor)
          u.setScale('x', { min: nMin, max: nMax })
        })

        // Drag: pan x-axis
        let dragStart: number | null = null
        let scaleStart: { min: number; max: number } | null = null

        over.addEventListener('mousedown', (e: MouseEvent) => {
          if (e.button !== 0) return
          dragStart = e.clientX
          scaleStart = { min: xMin(), max: xMax() }
        })

        window.addEventListener('mousemove', (e: MouseEvent) => {
          if (dragStart === null || !scaleStart) return
          _zoomed.add(u)
          const { width } = over.getBoundingClientRect()
          const dx = e.clientX - dragStart
          const range = scaleStart.max - scaleStart.min
          const shift = -(dx / width) * range
          u.setScale('x', {
            min: scaleStart.min + shift,
            max: scaleStart.max + shift,
          })
        })

        window.addEventListener('mouseup', () => {
          dragStart = null
          scaleStart = null
        })

        // Double-click: reset zoom and resume auto-range
        over.addEventListener('dblclick', () => {
          _zoomed.delete(u)
          u.setData(u.data, true)
        })
      },
    },
  }
}

/* ------------------------------------------------------------------ */
/*  LTTB downsampling – keep visual fidelity with fewer points        */
/* ------------------------------------------------------------------ */

/**
 * Largest-Triangle-Three-Buckets downsampling.
 * Operates on uPlot column arrays in-place-semantics.
 * Returns new column arrays with at most `threshold` points.
 */
export function downsampleLTTB(
  timestamps: number[],
  series: (number | null | undefined)[],
  threshold: number,
): { ts: number[]; vals: (number | null | undefined)[] } {
  const len = timestamps.length
  if (len <= threshold || threshold < 3) {
    return { ts: timestamps, vals: series }
  }

  const outTs: number[] = [timestamps[0]]
  const outVals: (number | null | undefined)[] = [series[0]]

  const bucketSize = (len - 2) / (threshold - 2)

  let a = 0 // index of previous selected point

  for (let i = 0; i < threshold - 2; i++) {
    const bucketStart = Math.floor((i + 1) * bucketSize) + 1
    const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1)

    // Average of next bucket for area computation
    let avgX = 0
    let avgY = 0
    let cnt = 0
    const nextStart = Math.floor((i + 2) * bucketSize) + 1
    const nextEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, len - 1)
    for (let j = nextStart; j < nextEnd; j++) {
      if (series[j] != null) {
        avgX += timestamps[j]
        avgY += (series[j] as number)
        cnt++
      }
    }
    if (cnt > 0) {
      avgX /= cnt
      avgY /= cnt
    }

    // Find point in current bucket with largest triangle area
    let maxArea = -1
    let maxIdx = bucketStart

    const ax = timestamps[a]
    const ay = (series[a] as number) ?? 0

    for (let j = bucketStart; j < bucketEnd; j++) {
      if (series[j] == null) continue
      const area = Math.abs(
        (ax - avgX) * ((series[j] as number) - ay) -
        (ax - timestamps[j]) * (avgY - ay),
      )
      if (area > maxArea) {
        maxArea = area
        maxIdx = j
      }
    }

    outTs.push(timestamps[maxIdx])
    outVals.push(series[maxIdx])
    a = maxIdx
  }

  // Always include last point
  outTs.push(timestamps[len - 1])
  outVals.push(series[len - 1])

  return { ts: outTs, vals: outVals }
}

/**
 * Downsample multiple series that share the same timestamp axis.
 * Each series is independently downsampled, then results are aligned
 * back to a common timestamp column.
 */
export function downsampleAligned(
  data: uPlot.AlignedData,
  maxPoints: number,
): uPlot.AlignedData {
  const ts = data[0] as number[]
  if (ts.length <= maxPoints) return data

  // For aligned data, downsample using the first series' timestamps
  // then just slice all series at those indices to keep alignment.
  // Simpler and preserves correlation between series.
  const step = Math.max(1, Math.floor(ts.length / maxPoints))
  const outTs: number[] = []
  const outSeries: (number | null | undefined)[][] = data.slice(1).map(() => [])

  for (let i = 0; i < ts.length; i += step) {
    outTs.push(ts[i])
    for (let s = 0; s < outSeries.length; s++) {
      outSeries[s].push((data[s + 1] as (number | null | undefined)[])[i])
    }
  }

  // Always include last point
  const last = ts.length - 1
  if ((last % step) !== 0) {
    outTs.push(ts[last])
    for (let s = 0; s < outSeries.length; s++) {
      outSeries[s].push((data[s + 1] as (number | null | undefined)[])[last])
    }
  }

  return [outTs, ...outSeries] as uPlot.AlignedData
}
