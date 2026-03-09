import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts'
import type { ProfilerData } from '../../types'
import { COLORS, AXIS_COLOR, GRID_COLOR, TEXT_SECONDARY, BG_CARD, BORDER_COLOR, TEXT_PRIMARY } from '../../theme'
import { mergeByTimestamp, formatTime } from '../../utils'

interface Props {
  data: ProfilerData
}

export function JitterChart({ data }: Props) {
  const hosts = data.hosts || []
  const merged = mergeByTimestamp(data.jitter || {}, hosts)
  const events = data.events_raw || []

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
        {hosts.map((host, i) => (
          <Line
            key={host}
            type="monotone"
            dataKey={host}
            stroke={COLORS[i % COLORS.length]}
            dot={false}
            connectNulls
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        ))}
        {events
          .filter((e) => e.kind === 'disconnect')
          .map((e, i) => (
            <ReferenceLine
              key={`d${i}`}
              x={e.ts}
              stroke="#ef4444"
              strokeDasharray="4 4"
            />
          ))}
        {events
          .filter((e) => e.kind === 'reconnect')
          .map((e, i) => (
            <ReferenceLine
              key={`r${i}`}
              x={e.ts}
              stroke="#22c55e"
              strokeDasharray="4 4"
            />
          ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
