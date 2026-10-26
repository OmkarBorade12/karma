import React, { useEffect, useState } from 'react'
import { api, apiSafe } from '../api'
import { DEMO_PROFILE } from '../demoData'

const EMPTY_FORM = {
  name: '',
  headline: '',
  summary: '',
  email: '',
  location: '',
  links: { github: '', linkedin: '', portfolio: '' },
}

export default function Profile() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [demo, setDemo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    apiSafe('/profile', { profile: DEMO_PROFILE }).then((d) => {
      if (cancelled) return
      const p = d?.profile || DEMO_PROFILE
      setForm({
        name: p.name || '',
        headline: p.headline || '',
        summary: p.summary || '',
        email: p.email || '',
        location: p.location || '',
        links: {
          github: p.links?.github || '',
          linkedin: p.links?.linkedin || '',
          portfolio: p.links?.portfolio || '',
        },
      })
      setDemo(d?.demo === true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const setLink = (key) => (e) => setForm((f) => ({ ...f, links: { ...f.links, [key]: e.target.value } }))

  async function save(e) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSaving(true)
    try {
      const res = await api('/profile', { method: 'POST', body: form })
      const p = res.profile || {}
      setForm((f) => ({
        ...f,
        name: p.name || f.name,
        headline: p.headline || f.headline,
        summary: p.summary || f.summary,
        email: p.email || f.email,
        location: p.location || f.location,
      }))
      setNotice('Profile saved.')
      setDemo(false)
    } catch (err) {
      setError(`Save failed: ${err.message}. Without a backend your profile lives only in this form (demo data).`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2>Profile</h2>
      {demo && <div className="muted small">Edit the seeded/demo profile and save to persist it in the backend memory.</div>}
      {notice && <div className="notice" data-testid="profile-notice">{notice}</div>}
      {error && <div className="error-banner" role="alert" data-testid="profile-error">{error}</div>}

      <form onSubmit={save} className="form-grid" data-testid="profile-form">
        <label htmlFor="profile-name">Name</label>
        <input id="profile-name" data-testid="profile-name" value={form.name} onChange={set('name')} />

        <label htmlFor="profile-headline">Headline</label>
        <input id="profile-headline" data-testid="profile-headline" value={form.headline} onChange={set('headline')} />

        <label htmlFor="profile-summary">Summary</label>
        <textarea id="profile-summary" rows={4} data-testid="profile-summary" value={form.summary} onChange={set('summary')} />

        <label htmlFor="profile-email">Email</label>
        <input id="profile-email" data-testid="profile-email" type="text" value={form.email} onChange={set('email')} />

        <label htmlFor="profile-location">Location</label>
        <input id="profile-location" data-testid="profile-location" value={form.location} onChange={set('location')} />

        <label htmlFor="profile-github">GitHub</label>
        <input id="profile-github" data-testid="profile-github" value={form.links.github} onChange={setLink('github')} />

        <label htmlFor="profile-linkedin">LinkedIn</label>
        <input id="profile-linkedin" data-testid="profile-linkedin" value={form.links.linkedin} onChange={setLink('linkedin')} />

        <label htmlFor="profile-portfolio">Portfolio</label>
        <input id="profile-portfolio" data-testid="profile-portfolio" value={form.links.portfolio} onChange={setLink('portfolio')} />

        <div className="form-actions">
          <button type="submit" disabled={saving} data-testid="profile-save">
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </section>
  )
}
