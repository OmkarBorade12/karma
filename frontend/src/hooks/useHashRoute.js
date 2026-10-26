import { useEffect, useState } from 'react'

const DEFAULT_TAB = 'Dashboard'

function tabFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (!raw) return DEFAULT_TAB
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

// Hash-based routing: tabs survive refresh/back navigation (#/ask etc.).
export default function useHashRoute(validTabs) {
  const resolve = (value) => (validTabs.includes(value) ? value : DEFAULT_TAB)

  const [tab, setTab] = useState(() => resolve(tabFromHash()))

  useEffect(() => {
    const onHash = () => setTab(resolve(tabFromHash()))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validTabs.join('|')])

  const select = (next) => {
    if (next !== tab) window.location.hash = `#/${next.toLowerCase()}`
    setTab(resolve(next))
  }

  return [tab, select]
}
