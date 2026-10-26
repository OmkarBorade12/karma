import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import App from '../App.jsx'

// Stubs for the /api endpoints the dashboard calls on mount.
const apiResponses = {}

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url) => {
      const match = Object.keys(apiResponses).find((k) => url === `/api${k}`)
      if (!match || apiResponses[match] == null) {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(apiResponses[match]) })
    })
  )
}

beforeEach(() => {
  stubFetch()
  for (const k of Object.keys(apiResponses)) delete apiResponses[k]
  cleanup()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App navigation', () => {
  it('renders the KARMA shell with all tabs and marks backend online', async () => {
    apiResponses['/health'] = { ok: true, autopilot: { scheduled: false, running: false } }
    render(<App />)
    expect(screen.getByRole('heading', { name: /karma/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/backend online/i)).toBeInTheDocument())
    for (const tab of ['Dashboard', 'Ask', 'Experience', 'Reports']) {
      expect(screen.getByTestId(`tab-${tab}`)).toBeInTheDocument()
    }
  })

  it('shows demo-mode pill when backend is offline', async () => {
    apiResponses['/health'] = undefined
    render(<App />)
    await waitFor(() => expect(screen.getByText(/demo mode/i)).toBeInTheDocument())
  })

  it('navigates tabs', async () => {
    apiResponses['/health'] = { ok: true }
    apiResponses['/experience'] = { experiences: [], analytics: { total: 0, topSkills: [] } }
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-Experience'))
    await waitFor(() => expect(screen.getByRole('heading', { name: /your experience memory/i })).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('tab-Ask'))
    expect(screen.getByTestId('ask-input')).toBeInTheDocument()
  })
})

describe('Dashboard (autopilot timeline)', () => {
  it('lists runs with DDA phases and stats', async () => {
    apiResponses['/health'] = { ok: true }
    apiResponses['/runs'] = {
      runs: [
        {
          _id: 'r1',
          status: 'success',
          trigger: 'manual',
          startedAt: new Date().toISOString(),
          durationMs: 500,
          steps: [
            { phase: 'discover', action: 'Analyzed index (8 chunks)', success: true, durationMs: 10 },
            { phase: 'digest', action: 'Generated 3 insight reports', success: true, durationMs: 20 },
            { phase: 'augment', action: 'Indexed 2 new chunks', success: true, durationMs: 30 },
          ],
          stats: { chunksIndexed: 2, reportsCreated: 3, documentsAugmented: 1, questionsEvaluated: 5 },
        },
      ],
    }
    apiResponses['/reports'] = { reports: [] }
    apiResponses['/agent/status'] = { scheduled: false, running: false }

    render(<App />)
    fireEvent.click(screen.getByTestId('tab-Dashboard'))

    await waitFor(() => expect(screen.getAllByTestId('run-card').length).toBe(1))
    expect(screen.getByText('discover')).toBeInTheDocument()
    expect(screen.getByText('digest')).toBeInTheDocument()
    expect(screen.getByText('augment')).toBeInTheDocument()
    expect(screen.getByText(/chunks indexed: 2/i)).toBeInTheDocument()
    expect(screen.getByText('Run autopilot cycle now')).toBeInTheDocument()
  })
})

describe('Ask (RAG UI)', () => {
  it('submits a question and shows the cited answer', async () => {
    apiResponses['/health'] = { ok: true }
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-Ask'))

    // fetch for POST /api/ask via our stub: register on generic matching too
    vi.stubGlobal(
      'fetch',
      vi.fn((url, options = {}) => {
        if (url === '/api/ask' && options.method === 'POST') {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                question: 'q',
                answer: 'Built apps with React [1]',
                references: [{ n: 1, sourceTitle: 'MERN practice', heading: null, sourceType: 'experience' }],
                confidence: 0.7,
                metrics: { mode: 'local-extractive' },
              }),
          })
        }
        return Promise.resolve({ ok: apiResponses['/health'] ? true : false, json: () => Promise.resolve({}) })
      })
    )

    fireEvent.change(screen.getByTestId('ask-input'), { target: { value: 'What have I built with React?' } })
    fireEvent.click(screen.getByTestId('ask-submit'))

    await waitFor(() => expect(screen.getByTestId('answer-card')).toBeInTheDocument())
    expect(screen.getByText(/Built apps with React/i)).toBeInTheDocument()
    expect(screen.getByText(/MERN practice/i)).toBeInTheDocument()
    expect(screen.getByText(/confidence: 70%/i)).toBeInTheDocument()
  })

  it('does not submit when question is empty', async () => {
    apiResponses['/health'] = { ok: true }
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-Ask'))
    fireEvent.click(screen.getByTestId('ask-submit'))
    expect(screen.queryByTestId('answer-card')).not.toBeInTheDocument()
  })
})

describe('Experience panel', () => {
  it('shows entries with skills from the API', async () => {
    apiResponses['/health'] = { ok: true }
    apiResponses['/experience'] = {
      experiences: [
        {
          _id: 'x1',
          title: 'ML Foundations',
          kind: 'education',
          description: 'Core ML study.',
          highlights: ['Trained classifiers.'],
          skills: ['Python', 'pandas'],
        },
      ],
      analytics: { total: 1, topSkills: [{ skill: 'python', count: 2 }] },
    }
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-Experience'))
    await waitFor(() => expect(screen.getAllByTestId('experience-card').length).toBe(1))
    expect(screen.getByText('ML Foundations')).toBeInTheDocument()
    expect(screen.getByText(/core skills/s)).toBeInTheDocument()
    expect(screen.getByText('Trained classifiers.')).toBeInTheDocument()
  })
})

describe('Reports panel', () => {
  it('renders skill-gap reports with observed/missing chips', async () => {
    apiResponses['/health'] = { ok: true }
    apiResponses['/reports'] = {
      reports: [
        {
          _id: 'rp1',
          kind: 'skill-gap',
          title: 'Skill-gap analysis (30% coverage)',
          summary: 'Sum text.',
          body: { observed: ['python'], missing: ['docker'], advice: 'learn docker' },
          createdAt: new Date().toISOString(),
        },
      ],
    }
    render(<App />)
    fireEvent.click(screen.getByTestId('tab-Reports'))
    await waitFor(() => expect(screen.getAllByTestId('report-card').length).toBe(1))
    expect(screen.getByText(/skill-gap analysis/i)).toBeInTheDocument()
    expect(screen.getByText('docker')).toBeInTheDocument()
  })
})
