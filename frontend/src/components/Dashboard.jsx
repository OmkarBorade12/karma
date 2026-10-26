import React, { useEffect, useState } from 'react'
import { api, apiSafe } from '../api'
import { DEMO_AGENT_STATUS, DEMO_REPORTS, DEMO_RUNS } from '../demoData'

export default function Dashboard({ online, checkNow }) {
  const [runs, setRuns] = useState([])
  const [reports, setReports] = useState([])
  const [status, setStatus] = useState(null)
  const [actionBusy, setActionBusy] = useState(null) // 'run' | 'schedule' | null
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [r, rp, s] = await Promise.all([
        apiSafe('/runs', { runs: DEMO_RUNS }),
        apiSafe('/reports', { reports: DEMO_REPORTS }),
        apiSafe('/agent/status', DEMO_AGENT_STATUS),
      ])
      if (cancelled) return
      setRuns(r.runs || [])
      setReports(rp.reports || [])
      setStatus(s)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function runOnce() {
    setError(null)
    setActionBusy('run')
    try {
      await api('/agent/run', { method: 'POST', body: {} })
      const [r, rp] = await Promise.all([
        apiSafe('/runs', { runs: DEMO_RUNS }),
        apiSafe('/reports', { reports: DEMO_REPORTS }),
      ])
      setRuns(r.runs || [])
      setReports(rp.reports || [])
    } catch (err) {
      setError(
        `Autopilot cycle failed: ${err.message}${online ? '' : ' — backend offline, the timeline below is demo data.'}`
      )
    } finally {
      setActionBusy(null)
      if (checkNow) checkNow()
    }
  }

  async function toggleAutopilot() {
    setError(null)
    setActionBusy('schedule')
    const action = status?.scheduled ? 'stop' : 'start'
    try {
      const res = await api(`/agent/autopilot/${action}`, { method: 'POST', body: {} })
      setStatus((s) => ({ ...(s || {}), scheduled: Boolean(res.started) }))
    } catch (err) {
      setError(
        `${action === 'start' ? 'Starting' : 'Stopping'} scheduled autopilot failed: ${err.message}${
          online ? '' : ' — backend offline.'
        }`
      )
    } finally {
      setActionBusy(null)
      if (checkNow) checkNow()
    }
  }

  const demoBadge = status?.demo ? ' (demo data)' : ''

  return (
    <section>
      <div className="controls">
        <button onClick={runOnce} disabled={actionBusy !== null} data-testid="run-once">
          {actionBusy === 'run' ? 'Running cycle…' : 'Run autopilot cycle now'}
        </button>
        <button onClick={toggleAutopilot} disabled={actionBusy !== null} data-testid="toggle-autopilot">
          {status?.scheduled ? 'Stop scheduled autopilot' : 'Start scheduled autopilot'}
        </button>
        <span className="muted" data-testid="agent-status">
          scheduled: {String(status?.scheduled ?? false)} · running: {String(status?.running ?? false)}
          {demoBadge}
        </span>
      </div>

      {error && (
        <div className="error-banner" role="alert" data-testid="action-error">
          {error}
        </div>
      )}

      <h2>Autopilot run timeline</h2>
      {runs.length === 0 && <p className="muted">No runs yet — trigger one above.</p>}
      {runs.map((run) => (
        <article className="card" key={run._id} data-testid="run-card">
          <header>
            <strong>{run.status}</strong>{' '}
            <span className="muted">
              trigger: {run.trigger} · {new Date(run.startedAt).toLocaleString()} · {run.durationMs}ms
            </span>
          </header>
          <ol className="steps">
            {(run.steps || []).map((s, i) => (
              <li key={i}>
                <span className={`phase ${s.phase}`}>{s.phase}</span> {s.action}
                {!s.success && <span className="warn"> failed</span>}
                <span className="muted"> ({s.durationMs}ms)</span>
              </li>
            ))}
          </ol>
          {run.issues?.length > 0 && (
            <p className="warn small">issues: {run.issues.join('; ')}</p>
          )}
          <p className="muted small">
            chunks indexed: {run.stats?.chunksIndexed} · reports: {run.stats?.reportsCreated} · augmented sources:{' '}
            {run.stats?.documentsAugmented} · probe questions: {run.stats?.questionsEvaluated}
          </p>
        </article>
      ))}

      <h2>Latest report titles</h2>
      <ul>
        {reports.slice(0, 6).map((r) => (
          <li key={r._id}>
            <strong>{r.kind}</strong> — {r.title}
          </li>
        ))}
        {reports.length === 0 && <li className="muted">No reports yet.</li>}
      </ul>
    </section>
  )
}
