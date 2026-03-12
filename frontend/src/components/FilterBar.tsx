import { COLORS } from '../theme'

/* ------------------------------------------------------------------ */
/*  Reusable toggle chip                                              */
/* ------------------------------------------------------------------ */

interface ChipProps {
  label: string
  active: boolean
  color?: string
  onToggle: () => void
}

function Chip({ label, active, color, onToggle }: ChipProps) {
  const style: React.CSSProperties = active && color
    ? { background: color, borderColor: color, color: '#fff' }
    : {}

  return (
    <button
      className={`filter-chip ${active ? 'active' : ''}`}
      style={style}
      onClick={onToggle}
    >
      {label}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Panel identifiers                                                 */
/* ------------------------------------------------------------------ */

export type PanelId =
  | 'latency'
  | 'packetLoss'
  | 'jitter'
  | 'dns'
  | 'throughput'
  | 'pingSummary'
  | 'dnsSummary'

export const ALL_PANELS: { id: PanelId; label: string }[] = [
  { id: 'latency', label: 'Latency' },
  { id: 'packetLoss', label: 'Packet Loss' },
  { id: 'jitter', label: 'Jitter' },
  { id: 'dns', label: 'DNS' },
  { id: 'throughput', label: 'Throughput' },
  { id: 'pingSummary', label: 'Ping Table' },
  { id: 'dnsSummary', label: 'DNS Table' },
]

/* ------------------------------------------------------------------ */
/*  FilterBar                                                         */
/* ------------------------------------------------------------------ */

interface Props {
  /** Which panels are visible */
  panels: Set<PanelId>
  onTogglePanel: (id: PanelId) => void

  /** Whether DC/RC event markers are shown on charts */
  showEvents: boolean
  onToggleEvents: () => void

  /** Which hosts are visible (ping-related charts + table) */
  hosts: string[]
  visibleHosts: Set<string>
  onToggleHost: (host: string) => void

  /** Which domains are visible (DNS chart + table) */
  domains: string[]
  visibleDomains: Set<string>
  onToggleDomain: (domain: string) => void

  /** Which interface is visible for throughput */
  interfaces: string[]
  selectedInterface: string | null
  onSelectInterface: (iface: string) => void
}

export function FilterBar({
  panels,
  onTogglePanel,
  showEvents,
  onToggleEvents,
  hosts,
  visibleHosts,
  onToggleHost,
  domains,
  visibleDomains,
  onToggleDomain,
  interfaces,
  selectedInterface,
  onSelectInterface,
}: Props) {
  return (
    <div className="filter-bar">
      {/* --- Panels --- */}
      <div className="filter-group">
        <span className="filter-group-label">Panels</span>
        <div className="filter-chips">
          {ALL_PANELS.map((p) => (
            <Chip
              key={p.id}
              label={p.label}
              active={panels.has(p.id)}
              onToggle={() => onTogglePanel(p.id)}
            />
          ))}
        </div>
      </div>

      {/* --- Display --- */}
      <div className="filter-group">
        <span className="filter-group-label">Display</span>
        <div className="filter-chips">
          <Chip
            label="DC/RC Markers"
            active={showEvents}
            onToggle={onToggleEvents}
          />
        </div>
      </div>

      {/* --- Hosts --- */}
      {hosts.length > 0 && (
        <div className="filter-group">
          <span className="filter-group-label">Hosts</span>
          <div className="filter-chips">
            {hosts.map((h, i) => (
              <Chip
                key={h}
                label={h}
                active={visibleHosts.has(h)}
                color={COLORS[i % COLORS.length]}
                onToggle={() => onToggleHost(h)}
              />
            ))}
          </div>
        </div>
      )}

      {/* --- Domains --- */}
      {domains.length > 0 && (
        <div className="filter-group">
          <span className="filter-group-label">Domains</span>
          <div className="filter-chips">
            {domains.map((d, i) => (
              <Chip
                key={d}
                label={d}
                active={visibleDomains.has(d)}
                color={COLORS[i % COLORS.length]}
                onToggle={() => onToggleDomain(d)}
              />
            ))}
          </div>
        </div>
      )}

      {/* --- Interfaces --- */}
      {interfaces.length > 0 && (
        <div className="filter-group">
          <span className="filter-group-label">Interface</span>
          <div className="filter-chips">
            {interfaces.map((iFace) => (
              <Chip
                key={iFace}
                label={iFace}
                active={selectedInterface === iFace}
                onToggle={() => onSelectInterface(iFace)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
