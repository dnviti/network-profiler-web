import { useMemo } from 'react'
import type uPlot from 'uplot'
import type { ProfilerData } from '../../types'
import { AXIS_COLOR, GRID_COLOR } from '../../theme'
import { toThroughputData } from '../../utils'
import { UPlotChart, wheelZoomPlugin, downsampleAligned } from './UPlotChart'

const MAX_POINTS = 2000

interface Props {
  data: ProfilerData
  selectedInterface: string
}

export function ThroughputChart({ data, selectedInterface }: Props) {
  const chartData = useMemo(
    () => downsampleAligned(
      toThroughputData(
        data.tp_down?.[selectedInterface] || [],
        data.tp_up?.[selectedInterface] || []
      ),
      MAX_POINTS,
    ),
    [data.tp_down, data.tp_up, selectedInterface],
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
        label: 'kbps',
        labelFont: '11px system-ui',
        labelSize: 28,
      },
    ],
    scales: { x: { time: true }, y: { min: 0 } },
    series: [
      { label: 'Time', value: '{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}' },
      {
        label: 'Download',
        stroke: '#3b82f6',
        fill: 'rgba(59,130,246,0.12)',
        width: 1.5,
        spanGaps: true,
      },
      {
        label: 'Upload',
        stroke: '#22c55e',
        fill: 'rgba(34,197,94,0.12)',
        width: 1.5,
        spanGaps: true,
      },
    ],
  }), [])

  return <UPlotChart options={options} data={chartData} />
}
