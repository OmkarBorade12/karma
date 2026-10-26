// Bundled demo data used when the backend is unreachable or errors out — the
// dashboard stays explorable in demo mode. Single source of truth for all
// demo fixtures.

export const DEMO_PROFILE = {
  name: 'Your Name',
  headline: 'AIML + Full-Stack (MERN) developer',
  summary:
    'AIML + MERN stack developer focused on retrieval-augmented systems. React, Node, Express, MongoDB, Python and RAG pipelines.',
  email: '',
  location: '',
  links: { github: '', linkedin: '', portfolio: '' },
}

export const DEMO_EXPERIENCES = [
  {
    _id: 'demo-1',
    title: 'Machine Learning Foundations',
    organization: 'Self-directed learning + labs',
    kind: 'education',
    description:
      'Studied core machine learning: regression, classification, clustering, model evaluation, feature engineering and overfitting controls.',
    skills: ['Python', 'NumPy', 'pandas', 'scikit-learn'],
    highlights: ['Trained and evaluated classifiers on tabular datasets.'],
    ongoing: false,
  },
  {
    _id: 'demo-2',
    title: 'Full-Stack MERN development practice',
    organization: 'Personal projects',
    kind: 'project',
    description:
      'Built multiple full-stack applications with React, Node.js, Express and MongoDB: REST APIs, authentication, dashboards.',
    skills: ['React', 'Node.js', 'Express', 'MongoDB'],
    highlights: ['Designed and built Express REST APIs with Mongoose models.'],
    ongoing: false,
  },
]

export function demoExperienceAnalytics() {
  const kindCounts = {}
  const skillFrequency = {}
  for (const e of DEMO_EXPERIENCES) {
    kindCounts[e.kind] = (kindCounts[e.kind] || 0) + 1
    for (const s of e.skills || []) {
      const k = s.toLowerCase().trim()
      if (k) skillFrequency[k] = (skillFrequency[k] || 0) + 1
    }
  }
  const topSkills = Object.entries(skillFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([skill, count]) => ({ skill, count }))
  return { total: DEMO_EXPERIENCES.length, kindCounts, topSkills, demo: true }
}

export const DEMO_REPORTS = [
  {
    _id: 'demo-report',
    kind: 'skill-gap',
    title: 'Skill-gap analysis vs AIML+MERN+RAG target profile (demo)',
    summary: 'The memory index currently evidences core ML and MERN skills — start the backend for live reports.',
    body: { observed: ['python', 'react', 'mongodb'], missing: ['docker', 'deployment'] },
    createdAt: new Date().toISOString(),
  },
]

export const DEMO_RUNS = [
  {
    _id: 'demo-run',
    trigger: 'demo',
    status: 'success',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 320,
    steps: [
      { phase: 'discover', action: 'Analyzed demo corpus', success: true, durationMs: 40 },
      { phase: 'digest', action: 'Generated 3 insight reports', success: true, durationMs: 120 },
      { phase: 'augment', action: 'Indexed 2 new chunks', success: true, durationMs: 100 },
    ],
    stats: { chunksIndexed: 2, reportsCreated: 3, documentsAugmented: 1, questionsEvaluated: 5 },
  },
]

export const DEMO_DOCUMENTS = [
  {
    _id: 'doc-demo-1',
    title: 'Starter resume',
    sourceType: 'resume',
    chunkCount: 4,
    autonomouslyGenerated: false,
    createdAt: new Date().toISOString(),
  },
]

export const DEMO_AGENT_STATUS = { scheduled: false, running: false, demo: true }
