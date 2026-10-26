import React, { useEffect, useState } from 'react'
import { apiSafe } from '../api'
import { DEMO_REPORTS } from '../demoData'

// Known report kinds get tailored renderers; anything else falls back to a
// generic key/value view so report bodies are never silently dropped.
function renderBody(r) {
  if (!r?.body) return null
  if (r.kind === 'skill-gap') {
    return (
      <div>
        <div className="skills">
          {(r.body.observed || []).map((s) => (
            <span className="skill ok" key={s}>
              {s}
            </span>
          ))}
          {(r.body.missing || []).map((s) => (
            <span className="skill gap" key={s}>
              {s}
            </span>
          ))}
        </div>
        {r.body.advice && <p className="muted small">{r.body.advice}</p>}
      </div>
    )
  }
  if (r.kind === 'trajectory' && r.body.topSkills) {
    return (
      <div className="skills">
        {r.body.topSkills.map((t) => (
          <span className="skill" key={t.skill}>
            {t.skill} × {t.count}
          </span>
        ))}
      </div>
    )
  }
  if (r.kind === 'retrieval-quality' && r.body.probes) {
    return (
      <ul className="small">
        {r.body.probes.map((p, i) => (
          <li key={i}>
            “{p.question}” — {p.hits} hits, coverage {Math.round((p.coverage || 0) * 100)}%{' '}
            <span className={p.healthy ? 'ok' : 'warn'}>{p.healthy ? 'healthy' : 'weak'}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul className="small generic-body">
      {Object.entries(r.body).map(([key, value]) => (
        <li key={key}>
          <strong>{key}:</strong> {value && typeof value === 'object' ? JSON.stringify(value) : String(value)}
        </li>
      ))}
    </ul>
  )
}

export default function Reports() {
  const [reports, setReports] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiSafe('/reports', { reports: DEMO_REPORTS, demo: true }).then((d) => {
      if (!cancelled) setReports(d.reports || [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section>
      <h2>Autonomous insight reports</h2>
      {(reports || []).map((r) => (
        <article className="card" key={r._id} data-testid="report-card">
          <header>
            <strong>{r.kind}</strong> <span className="muted">{new Date(r.createdAt).toLocaleString()}</span>
          </header>
          <h3>{r.title}</h3>
          <p>{r.summary}</p>
          {renderBody(r)}
        </article>
      ))}
      {(reports || []).length === 0 && <p className="muted">No reports yet — run the autopilot.</p>}
    </section>
  )
}
