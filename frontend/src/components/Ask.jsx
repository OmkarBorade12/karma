import React, { useState } from 'react'
import { api } from '../api'

export default function Ask() {
  const [question, setQuestion] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  async function ask(e) {
    e.preventDefault()
    if (!question.trim()) return
    setLoading(true)
    try {
      const res = await api('/ask', { method: 'POST', body: { question } })
      setResult(res)
    } catch (err) {
      setResult({
        answer: `Request failed: ${err.message}. Start the backend with \`cd backend && npm run dev\`, then ask again.`,
        references: [],
        confidence: 0,
        metrics: { mode: 'error' },
        error: true,
      })
    }
    setLoading(false)
  }

  return (
    <section>
      <h2>Ask your experience</h2>
      <form onSubmit={ask} className="ask-form">
        <input
          data-testid="ask-input"
          placeholder="e.g. What have I built with React and MongoDB?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={loading} data-testid="ask-submit">
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {result && (
        <div className={`card${result.error ? ' failure' : ''}`} data-testid="answer-card">
          <div className="confidence">
            confidence: {Math.round((result.confidence || 0) * 100)}% · mode: {result.metrics?.mode || 'local'}
          </div>
          <pre className="answer">{result.answer}</pre>
          {result.references?.length > 0 && (
            <div className="refs">
              <h3>Sources</h3>
              <ol>
                {result.references.map((r) => (
                  <li key={r.n}>
                    <strong>{r.sourceTitle}</strong>
                    {r.heading ? ` › ${r.heading}` : ''} <span className="muted">({r.sourceType})</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
