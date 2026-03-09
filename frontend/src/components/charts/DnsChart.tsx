import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import type { ProfilerData } from '../../types'
import { COLORS, AXIS_COLOR, GRID_COLOR, TEXT_SECONDARY, BG_CARD, BORDER_COLOR, TEXT_PRIMARY } from '../../theme'
import { mergeByTimestamp, formatTime } from '../../utils'

interface Props {
  data: ProfilerData
}

export function DnsChart({ data }: Props) {
  const domains = data.domains || []
  const merged = mergeByTimestamp(data.dns || {}, domains)

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={merged}>
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
        {domains.map((domain, i) => (
          <Line
            key={domain}
            type="monotone"
            dataKey={domain}
            stroke={COLORS[i % COLORS.length]}
            dot={false}
            connectNulls
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
