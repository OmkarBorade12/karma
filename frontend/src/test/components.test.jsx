import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import App from '../App.jsx'

// Route-keyed fetch stub: key is "METHOD path" with the /api prefix stripped.
// Routes that resolve to `{ __status: n }` produce an HTTP error response —
// intentionally testing the demo-fallback path, not just network rejection.
function stubFetch(routes = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      const key = `${method} ${url.replace(/^\/api/, '')}`
      const hit = routes[key]
      if (hit == null) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      if (hit.__status != null) {
        return Promise.resolve({ ok: false, status: hit.__status, json: () => Promise.resolve(hit.body || {}) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(hit) })
    })
  )
}

let routes

beforeEach(() => {
  routes = {}
  stubFetch(routes)
  cleanup()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openTab(testId) {
  render(<App />)
  fireEvent.click(screen.getByTestId(testId))
}

describe('Profile tab (editor)', () => {
  it('loads the stored profile into the form and saves changes', async () => {
    routes['GET /health'] = { ok: true }
    const saved = []
    routes['GET /profile'] = {
      profile: { name: 'Stored Name', headline: 'Stored headline', summary: 'Stored summary', email: '', location: '', links: { github: '', linkedin: '', portfolio: '' } },
    }
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      const key = `${method} ${url.replace(/^\/api/, '')}`
      if (key === 'POST /profile') {
        saved.push(JSON.parse(options.body))
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ profile: saved[0] }) })
      }
      const hit = routes[key]
      if (hit == null) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(hit) })
    }))

    await openTab('tab-Profile')
    await waitFor(() => expect(screen.getByTestId('profile-name')).toHaveValue('Stored Name'))
    expect(screen.getByTestId('profile-summary')).toHaveValue('Stored summary')

    fireEvent.change(screen.getByTestId('profile-name'), { target: { value: 'Saved Name' } })
    fireEvent.click(screen.getByTestId('profile-save'))

    await waitFor(() => expect(screen.getByTestId('profile-notice')).toHaveTextContent('Profile saved.'))
    expect(saved[0].name).toBe('Saved Name')
    await waitFor(() => expect(screen.getByTestId('profile-name')).toHaveValue('Saved Name'))
  })

  it('shows demo data and an honest error when the backend is offline', async () => {
    routes['GET /health'] = { ok: true }
    // GET /profile unregistered → HTTP error → demo fallback
    await openTab('tab-Profile')
    await waitFor(() => expect(screen.getByTestId('profile-name')).toBeInTheDocument())
    fireEvent.change(screen.getByTestId('profile-name'), { target: { value: 'Offline Edit' } })
    fireEvent.click(screen.getByTestId('profile-save'))

    await waitFor(() => expect(screen.getByTestId('profile-error')).toBeInTheDocument())
    expect(screen.getByTestId('profile-error').textContent).toMatch(/save failed/i)
    // the form still holds the user's edit (nothing silently faked)
    expect(screen.getByTestId('profile-name')).toHaveValue('Offline Edit')
  })
})

describe('Ingest tab (documents)', () => {
  it('lists documents, ingests a new one and reports chunk count', async () => {
    routes['GET /health'] = { ok: true }
    routes['GET /documents'] = {
      documents: [
        { _id: 'doc1', title: 'Doc One', sourceType: 'note', chunkCount: 3, autonomouslyGenerated: false, createdAt: new Date().toISOString() },
      ],
    }
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      const key = `${method} ${url.replace(/^\/api/, '')}`
      if (key === 'POST /documents') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ document: {}, chunkCount: 5 }) })
      }
      const hit = routes[key]
      if (hit == null) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(hit) })
    }))

    await openTab('tab-Ingest')
    await waitFor(() => expect(screen.getByTestId('doc-row')).toBeInTheDocument())
    expect(screen.getByText(/Doc One/)).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('ingest-title'), { target: { value: 'Fresh Note' } })
    fireEvent.change(screen.getByTestId('ingest-content'), { target: { value: 'Enough content to pass validation.' } })
    fireEvent.click(screen.getByTestId('ingest-submit'))

    await waitFor(() => expect(screen.getByTestId('ingest-notice')).toHaveTextContent(/5 chunks indexed/))
  })

  it('validates empty input client-side without a request', async () => {
    routes['GET /health'] = { ok: true }
    routes['GET /documents'] = { documents: [] }
    const postSpy = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/documents' && (options.method || 'GET').toUpperCase() === 'POST') {
        postSpy()
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      const key = `${(options.method || 'GET').toUpperCase()} ${url.replace(/^\/api/, '')}`
      const hit = routes[key]
      if (hit == null) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(hit) })
    }))

    await openTab('tab-Ingest')
    await waitFor(() => expect(screen.getByTestId('ingest-form')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('ingest-submit'))
    await waitFor(() => expect(screen.getByTestId('ingest-error')).toBeInTheDocument())
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('deletes a document and reports removed chunks', async () => {
    routes['GET /health'] = { ok: true }
    routes['GET /documents'] = {
      documents: [
        { _id: 'doc1', title: 'Doc One', sourceType: 'note', chunkCount: 3, createdAt: new Date().toISOString() },
      ],
    }
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      const method = (options.method || 'GET').toUpperCase()
      const key = `${method} ${url.replace(/^\/api/, '')}`
      if (key === 'DELETE /documents/doc1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ deleted: 'Doc One', chunksRemoved: 3 }) })
      }
      const hit = routes[key]
      if (hit == null) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(hit) })
    }))

    await openTab('tab-Ingest')
    await waitFor(() => expect(screen.getByTestId('doc-delete-doc1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('doc-delete-doc1'))
    await waitFor(() => expect(screen.getByTestId('ingest-notice')).toHaveTextContent(/Deleted “Doc One”/))
  })
})

describe('failure feedback + demo fallback correctness', () => {
  it('autopilot run failure surfaces an error banner instead of faking success', async () => {
    routes['GET /health'] = { ok: true }
    routes['GET /runs'] = { runs: [] }
    routes['GET /reports'] = { reports: [] }
    routes['GET /agent/status'] = { scheduled: false, running: false }
    routes['POST /agent/run'] = { __status: 500, body: { error: 'cycle exploded' } }

    await openTab('tab-Dashboard')
    fireEvent.click(screen.getByTestId('run-once'))

    await waitFor(() => expect(screen.getByTestId('action-error')).toBeInTheDocument())
    expect(screen.getByTestId('action-error').textContent).toMatch(/autopilot cycle failed/i)
    expect(screen.getByTestId('action-error').textContent).toContain('cycle exploded')
    // empty timeline still honest: no demo card pretended to run
    expect(screen.queryByTestId('run-card')).not.toBeInTheDocument()
  })

  it('HTTP errors (not just network failures) trigger demo fallback on reports', async () => {
    routes['GET /health'] = { ok: true }
    routes['GET /reports'] = { __status: 503, body: {} }

    await openTab('tab-Reports')
    await waitFor(() => expect(screen.getAllByTestId('report-card').length).toBeGreaterThanOrEqual(1))
    expect(screen.getByText(/demo\)/i)).toBeInTheDocument()
  })

  it('Ask shows a real error card when the backend returns an error', async () => {
    routes['GET /health'] = { ok: true }
    routes['POST /ask'] = { __status: 500, body: { error: 'internal rag failure' } }

    await openTab('tab-Ask')
    fireEvent.change(screen.getByTestId('ask-input'), { target: { value: 'question?' } })
    fireEvent.click(screen.getByTestId('ask-submit'))

    await waitFor(() => expect(screen.getByTestId('answer-card')).toBeInTheDocument())
    expect(screen.getByText(/request failed/i)).toBeInTheDocument()
    expect(JSON.stringify(screen.getByTestId('answer-card').textContent)).toContain('internal rag failure')
  })

  it('demo data appears via API error (headline regression) when runs fail with HTTP error', async () => {
    routes['GET /health'] = { ok: true }
    routes['GET /runs'] = { __status: 500 }
    routes['GET /reports'] = { __status: 500 }
    routes['GET /agent/status'] = { __status: 500 }

    await openTab('tab-Dashboard')
    await waitFor(() => expect(screen.getByTestId('run-card')).toBeInTheDocument())
    expect(screen.getByTestId('agent-status').textContent).toContain('demo data')
  })
})
