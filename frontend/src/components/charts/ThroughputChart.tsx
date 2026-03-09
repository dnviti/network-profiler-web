import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import type { ProfilerData } from '../../types'
import { AXIS_COLOR, GRID_COLOR, TEXT_SECONDARY, BG_CARD, BORDER_COLOR, TEXT_PRIMARY } from '../../theme'
import { mergeThroughput, formatTime } from '../../utils'

interface Props {
  data: ProfilerData
}

export function ThroughputChart({ data }: Props) {
  const merged = mergeThroughput(data.tp_down || [], data.tp_up || [])

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={merged}>
        <XAxis
          dataKey="time"
          tickFormatter={formatTime}
          tick={{ fill: AXIS_COLOR, fontSize: 11 }}
          stroke={GRID_COLOR}
        />
        <YAxis
          tick={{ fill: AXIS_COLOR, fontSize: 11 }}
          stroke={GRID_COLOR}
        />
        <Tooltip
          contentStyle={{
            background: BG_CARD,
            border: `1px solid ${BORDER_COLOR}`,
            color: TEXT_PRIMARY,
          }}
          labelFormatter={formatTime}
        />
        <Legend wrapperStyle={{ color: TEXT_SECONDARY, fontSize: 12 }} />
        <Area
          type="monotone"
          dataKey="download"
          stroke="#3b82f6"
          fill="#3b82f620"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="upload"
          stroke="#22c55e"
          fill="#22c55e20"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
