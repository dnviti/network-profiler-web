import { useEffect, useRef, useState, useCallback } from 'react'
import type { ProfilerData } from '../types'

const DEFAULT_MINUTES = 5

export function useWebSocket() {
  const [data, setData] = useState<ProfilerData | null>(null)
  const [connected, setConnected] = useState(false)
  const [minutes, setMinutes] = useState<number | null>(DEFAULT_MINUTES)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const minutesRef = useRef(minutes)

  // Keep the ref in sync so the connect callback always sees the latest value
  minutesRef.current = minutes

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const m = minutesRef.current
    const qs = m != null ? `?minutes=${m}` : ''
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws${qs}`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as ProfilerData
        if (!parsed.empty) setData(parsed)
      } catch {
        /* ignore parse errors */
      }
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  // When minutes changes, send a message to the server to update the range
  const changeMinutes = useCallback((newMinutes: number | null) => {
    setMinutes(newMinutes)
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ minutes: newMinutes }))
    }
  }, [])

  return { data, connected, minutes, setMinutes: changeMinutes }
}
