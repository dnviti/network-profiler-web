import { useMemo } from 'react'
import type uPlot from 'uplot'
import type { ProfilerData } from '../../types'
import { COLORS, AXIS_COLOR, GRID_COLOR } from '../../theme'
import { toAlignedData } from '../../utils'
import { UPlotChart, wheelZoomPlugin, downsampleAligned } from './UPlotChart'

const MAX_POINTS = 2000

interface Props {
  data: ProfilerData
  domains: string[]
}

export function DnsChart({ data, domains }: Props) {
  const allDomains = data.domains || []

  const chartData = useMemo(
    () => downsampleAligned(toAlignedData(data.dns || {}, domains), MAX_POINTS),
    [data.dns, domains],
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
      ...domains.map((domain) => ({
        label: domain,
        stroke: COLORS[allDomains.indexOf(domain) % COLORS.length],
        width: 1.5,
        spanGaps: true,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [domains.join(), allDomains.join()])

  return <UPlotChart options={options} data={chartData} />
}
