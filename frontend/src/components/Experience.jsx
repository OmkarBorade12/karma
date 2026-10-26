import React, { useEffect, useState } from 'react'
import { apiSafe } from '../api'
import { DEMO_EXPERIENCES, demoExperienceAnalytics } from '../demoData'

function dateRange(e) {
  const start = e.startDate ? new Date(e.startDate).toLocaleDateString() : null
  const end = e.ongoing ? 'present' : e.endDate ? new Date(e.endDate).toLocaleDateString() : null
  if (!start && !end) return null
  const left = start || '?'
  return end ? `${left} – ${end}` : left
}

export default function Experience() {
  const [data, setData] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiSafe('/experience', { experiences: DEMO_EXPERIENCES, analytics: demoExperienceAnalytics() }).then((d) => {
      if (!cancelled) setData(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section>
      <h2>Your experience memory</h2>
      {data?.analytics && (
        <div className="muted" data-testid="analytics">
          {data.analytics.total} entries · core skills:{' '}
          {(data.analytics.topSkills || []).map((s) => s.skill).join(', ')}
          {data.analytics.demo && !data.analytics.total ? ' (demo data)' : ''}
        </div>
      )}
      {(data?.experiences || []).map((e) => {
        const range = dateRange(e)
        return (
          <article className="card" key={e._id} data-testid="experience-card">
            <header>
              <strong>{e.title}</strong>{' '}
              <span className="muted">
                {e.kind}
                {e.organization ? ` · ${e.organization}` : ''}
                {range ? ` · ${range}` : ''}
              </span>
            </header>
            <p>{e.description}</p>
            {(e.highlights || []).length > 0 && <ul>{e.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>}
            <div className="skills">
              {(e.skills || []).map((s) => (
                <span className="skill" key={s}>
                  {s}
                </span>
              ))}
            </div>
          </article>
        )
      })}
      {(data?.experiences || []).length === 0 && (
        <p className="muted">No experiences yet — ingest your resume in the Ingest tab.</p>
      )}
      <p className="muted small">
        Add new sources through the Ingest tab (<code>POST /api/documents</code> under the hood) — pasting a resume
        parses, merges and indexes it automatically.
      </p>
    </section>
  )
}
