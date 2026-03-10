import { useMemo, useRef } from 'react'
import type uPlot from 'uplot'
import type { ProfilerData } from '../../types'
import { COLORS, AXIS_COLOR, GRID_COLOR } from '../../theme'
import { toAlignedData } from '../../utils'
import { UPlotChart, wheelZoomPlugin, downsampleAligned } from './UPlotChart'

const MAX_POINTS = 2000

interface Props {
  data: ProfilerData
  hosts: string[]
}

export function JitterChart({ data, hosts }: Props) {
  const allHosts = data.hosts || []
  const events = data.events_raw || []

  const eventsRef = useRef(events)
  eventsRef.current = events

  const chartData = useMemo(
    () => downsampleAligned(toAlignedData(data.jitter || {}, hosts), MAX_POINTS),
    [data.jitter, hosts],
  )

  const options = useMemo((): Omit<uPlot.Options, 'width' | 'height'> => ({
    cursor: { drag: { x: false, y: false } },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    plugins: [wheelZoomPlugin()],
    legend: { show: true },
    axes: [
      {
        stroke: AXIS_COLOR,
        grid: { stroke: GRID_COLOR, width: 1 },
        ticks: { stroke: GRID_COLOR, width: 1 },
        font: '11px system-ui',
      },
      {
        stroke: AXIS_COLOR,
        grid: { stroke: GRID_COLOR, width: 1 },
        ticks: { stroke: GRID_COLOR, width: 1 },
        font: '11px system-ui',
        label: 'ms',
        labelFont: '11px system-ui',
        labelSize: 20,
      },
    ],
    scales: { x: { time: true } },
    series: [
      { label: 'Time', value: '{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}' },
      ...hosts.map((host) => ({
        label: host,
        stroke: COLORS[allHosts.indexOf(host) % COLORS.length],
        width: 1.5,
        spanGaps: true,
      })),
    ],
    hooks: {
      draw: [
        (u: uPlot) => {
          const ctx = u.ctx
          const { left, top, width, height: h } = u.bbox
          const ev = eventsRef.current

          const disconnects = ev
            .filter((e) => e.kind === 'disconnect')
            .map((e) => new Date(e.ts).getTime() / 1000)
          const reconnects = ev
            .filter((e) => e.kind === 'reconnect')
            .map((e) => new Date(e.ts).getTime() / 1000)

          for (const ts of disconnects) {
            const x = u.valToPos(ts, 'x', true)
            if (x < left || x > left + width) continue
            ctx.save()
            ctx.strokeStyle = '#ef4444'
            ctx.lineWidth = 1
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(x, top)
            ctx.lineTo(x, top + h)
            ctx.stroke()
            ctx.restore()
          }
          for (const ts of reconnects) {
            const x = u.valToPos(ts, 'x', true)
            if (x < left || x > left + width) continue
            ctx.save()
            ctx.strokeStyle = '#22c55e'
            ctx.lineWidth = 1
            ctx.setLineDash([4, 4])
            ctx.beginPath()
            ctx.moveTo(x, top)
            ctx.lineTo(x, top + h)
            ctx.stroke()
            ctx.restore()
          }
        },
      ],
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [hosts.join(), allHosts.join()])

  return <UPlotChart options={options} data={chartData} />
}
