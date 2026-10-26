import React from 'react'
import useHealth from './hooks/useHealth'
import useHashRoute from './hooks/useHashRoute'
import Dashboard from './components/Dashboard'
import Ask from './components/Ask'
import Experience from './components/Experience'
import Reports from './components/Reports'
import Profile from './components/Profile'
import Ingest from './components/Ingest'

const TABS = ['Dashboard', 'Ask', 'Experience', 'Reports', 'Profile', 'Ingest']

export default function App() {
  const { online, checkNow } = useHealth()
  const [tab, setTab] = useHashRoute(TABS)

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>KARMA</h1>
          <p className="subtitle">Knowledge-Aware Recursive Memory Autopilot — your autonomous career intelligence</p>
        </div>
        <span className={`pill ${online ? 'ok' : 'warn'}`}>{online ? 'backend online' : 'demo mode (backend offline)'}</span>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {t}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'Dashboard' && <Dashboard online={online} checkNow={checkNow} />}
        {tab === 'Ask' && <Ask />}
        {tab === 'Experience' && <Experience />}
        {tab === 'Reports' && <Reports />}
        {tab === 'Profile' && <Profile />}
        {tab === 'Ingest' && <Ingest />}
      </main>

      <footer className="footer">Runs fully local RAG — BM25 + TF-IDF fusion, no external vector DB required.</footer>
    </div>
  )
}
