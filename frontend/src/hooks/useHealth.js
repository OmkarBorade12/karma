import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

const POLL_INTERVAL_MS = 30000

// Live backend health with periodic re-checks, so the online/demode pill never
// goes stale and failed actions can force an immediate re-probe.
export default function useHealth() {
  const [online, setOnline] = useState(false)

  const checkNow = useCallback(async () => {
    try {
      await api('/health')
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    checkNow()
    const id = setInterval(checkNow, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [checkNow])

  return { online, checkNow }
}
