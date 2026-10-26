import React, { useEffect, useState } from 'react'
import { api, apiSafe } from '../api'
import { DEMO_DOCUMENTS } from '../demoData'

const SOURCE_TYPES = ['resume', 'project', 'experience', 'note', 'certificate']

export default function Ingest() {
  const [docs, setDocs] = useState([])
  const [demo, setDemo] = useState(false)
  const [title, setTitle] = useState('')
  const [sourceType, setSourceType] = useState('note')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  async function loadDocuments() {
    const d = await apiSafe('/documents', { documents: DEMO_DOCUMENTS, demo: true })
    setDocs(d.documents || [])
    setDemo(Boolean(d.demo))
  }

  useEffect(() => {
    loadDocuments().catch(() => {})
  }, [])

  async function ingest(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    if (!title.trim() || content.trim().length < 10) {
      setError('A title and at least 10 characters of content are required.')
      return
    }
    setSubmitting(true)
    try {
      const res = await api('/documents', { method: 'POST', body: { title, content, sourceType } })
      setNotice(`Ingested “${title}” — ${res.chunkCount} chunks indexed.`)
      setTitle('')
      setContent('')
      await loadDocuments()
    } catch (err) {
      setError(`Ingest failed: ${err.message}${demo ? ' — backend offline, list below is demo data.' : ''}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function remove(id, docTitle) {
    setError(null)
    setNotice(null)
    try {
      const res = await api(`/documents/${id}`, { method: 'DELETE' })
      setNotice(`Deleted “${docTitle}” — ${res.chunksRemoved} chunks removed from the index.`)
      await loadDocuments()
    } catch (err) {
      setError(`Delete failed: ${err.message}`)
    }
  }

  return (
    <section>
      <h2>Ingest documents</h2>
      {demo && <div className="muted small">Backend offline — the document list below is demo data.</div>}
      {notice && <div className="notice" data-testid="ingest-notice">{notice}</div>}
      {error && <div className="error-banner" role="alert" data-testid="ingest-error">{error}</div>}

      <form onSubmit={ingest} className="form-grid" data-testid="ingest-form">
        <label htmlFor="ingest-title">Title</label>
        <input id="ingest-title" data-testid="ingest-title" value={title} onChange={(e) => setTitle(e.target.value)} />

        <label htmlFor="ingest-source">Source type</label>
        <select id="ingest-source" data-testid="ingest-source" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
          {SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label htmlFor="ingest-content">Content</label>
        <textarea
          id="ingest-content"
          rows={10}
          placeholder="Paste a resume, project notes, achievements… Resume-shaped text is parsed into profile + experiences automatically."
          data-testid="ingest-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />

        <div className="form-actions">
          <button type="submit" disabled={submitting} data-testid="ingest-submit">
            {submitting ? 'Ingesting…' : 'Ingest document'}
          </button>
        </div>
      </form>

      <h2>Ingested sources</h2>
      <ul className="doc-list">
        {docs.map((d) => (
          <li key={d._id} data-testid="doc-row">
            <span className="doc-meta">
              <strong>{d.title}</strong> · {d.sourceType} · {d.chunkCount} chunks
              {d.autonomouslyGenerated ? ' · autopilot' : ''} · {new Date(d.createdAt).toLocaleDateString()}
            </span>
            <button className="doc-delete" onClick={() => remove(d._id, d.title)} data-testid={`doc-delete-${d._id}`}>
              delete
            </button>
          </li>
        ))}
        {docs.length === 0 && <li className="muted">Nothing ingested yet.</li>}
      </ul>
    </section>
  )
}
