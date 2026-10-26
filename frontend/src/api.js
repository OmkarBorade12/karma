// API client with graceful demo fallback: if the backend is unreachable (or an
// HTTP error occurs) callers can render bundled demo data via apiSafe().
// In dev the Vite proxy routes /api to the backend; in split deployments set
// VITE_API_BASE_URL (e.g. https://karma-api.vercel.app/api) at build time.

const API_ROOT = import.meta.env?.VITE_API_BASE_URL || '/api'

export async function api(path, options = {}) {
  const { body, headers, ...rest } = options
  const res = await fetch(`${API_ROOT}${path}`, {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`)
  return data
}

export async function apiSafe(path, fallback, options = {}) {
  try {
    return await api(path, options)
  } catch {
    return fallback
  }
}
