import { describe, it, expect, afterEach, vi } from 'vitest'
import { api, apiSafe } from '../api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api()', () => {
  it('prefixes /api and returns parsed JSON', async () => {
    const fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => ({ value: url === '/api/reports' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await api('/reports')
    expect(data.value).toBe(true)
  })

  it('JSON-serializes the body and sets Content-Type on POST', async () => {
    const fetchMock = vi.fn(async (url, options) => ({
      ok: true,
      json: async () => ({ url, body: options.body, type: options.headers['Content-Type'] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await api('/ask', { method: 'POST', body: { question: 'hi' } })
    const init = fetchMock.mock.calls[0][1]
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ask')
    expect(init.body).toBe(JSON.stringify({ question: 'hi' }))
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('does not set Content-Type on bodyless GETs', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await api('/health')
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.body).toBeUndefined()
  })

  it('caller headers merge instead of wiping the default Content-Type', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await api('/ask', {
      method: 'POST',
      body: { x: 1 },
      headers: { Authorization: 'Bearer token' },
    })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer token')
  })

  it('throws an Error carrying the API error message on !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'boom message' }) }))
    )
    await expect(api('/ask')).rejects.toThrow('boom message')
  })

  it('falls back to a generic message when the error body has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }))
    )
    await expect(api('/ask')).rejects.toThrow('API error 502')
  })
})

describe('apiSafe()', () => {
  it('returns data on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ reports: [1, 2] }) }))
    )
    await expect(apiSafe('/reports', { reports: [] })).resolves.toEqual({ reports: [1, 2] })
  })

  it('returns the fallback on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network down'))))
    await expect(apiSafe('/reports', { demo: true })).resolves.toEqual({ demo: true })
  })

  it('returns the fallback on HTTP errors too (demo fallback correctness)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )
    await expect(apiSafe('/reports', { demo: true })).resolves.toEqual({ demo: true })
  })
})
