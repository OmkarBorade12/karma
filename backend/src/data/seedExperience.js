// ─────────────────────────────────────────────────────────────────────────────
// KARMA BASELINE EXPERIENCE — EDIT THIS FILE with YOUR real details.
//
// This is the autonomous baseline: on first boot with an empty database,
// KARMA ingests everything below into its RAG memory. Replace the placeholder
// entries with leters describing your actual resume, projects and notes — or
// simply paste your resume through the dashboard's "Ingest" tab, which parses
// and merges it automatically.
// ─────────────────────────────────────────────────────────────────────────────

const SEED_PROFILE = {
  name: 'Your Name',
  headline: 'AIML + Full-Stack (MERN) developer',
  summary:
    'AIML + MERN stack developer focused on retrieval-augmented intelligent systems. Works with React, Node, Express, MongoDB, Python and RAG pipelines, and has built projects spanning machine learning models, REST APIs and autonomous agents. Enjoys systems that continuously improve themselves.',
  email: 'you@example.com',
  location: '',
  links: { github: '', linkedin: '', portfolio: '' },
};

const SEED_EXPERIENCES = [
  {
    title: 'Machine Learning Foundations',
    organization: 'Self-directed learning + labs',
    kind: 'education',
    description:
      'Studied core machine learning: regression, classification, clustering, model evaluation, feature engineering and overfitting controls. Practised in Python with NumPy, pandas and scikit-learn through notebook labs.',
    skills: ['Python', 'NumPy', 'pandas', 'scikit-learn', 'model evaluation', 'feature engineering'],
    highlights: [
      'Trained and evaluated classifiers on tabular datasets with accuracy, precision, recall and F1 reporting.',
      'Practised train/validation/test discipline and cross-validation to control overfitting.',
    ],
  },
  {
    title: 'RAG and intelligent-systems study',
    organization: 'Self-directed',
    kind: 'education',
    description:
      'Deep study of retrieval-augmented generation: chunking strategies, embeddings, vector similarity, hybrid keyword-vector retrieval, reranking and grounded answer synthesis. Implemented the full pipeline from scratch in JavaScript for this autonomous memory project.',
    skills: ['RAG', 'embeddings', 'TF-IDF', 'BM25', 'reranking', 'chunking', 'information retrieval'],
    highlights: [
      'Implemented a hybrid BM25 + TF-IDF-cosine retriever with reciprocal rank fusion.',
      'Designed overlap-preserving structural chunking for resumes and project notes.',
    ],
  },
  {
    title: 'Full-Stack MERN development practice',
    organization: 'Personal projects',
    kind: 'project',
    description:
      'Built multiple full-stack applications with React, Node.js, Express and MongoDB: REST APIs, authentication, data models, dashboards and frontend state handling.',
    skills: ['React', 'Node.js', 'Express', 'MongoDB', 'Mongoose', 'REST API', 'JWT', 'Vite'],
    highlights: [
      'Designed and built Express REST APIs with Mongoose models and validation.',
      'Created React dashboards consuming those APIs with clean component structure.',
    ],
  },
  {
    title: 'Software engineering workflows',
    organization: 'Personal projects',
    kind: 'personal',
    description:
      'Regular practice with Git, code review discipline, testing (unit + integration), debugging in Node and browser environments, and writing clear project documentation.',
    skills: ['Git', 'GitHub', 'testing', 'Jest', 'debugging', 'documentation'],
    highlights: [
      'Wrote unit and integration test suites covering API flows end to end.',
      'Documented architecture decisions in project READMEs.',
    ],
  },
];

module.exports = { SEED_PROFILE, SEED_EXPERIENCES };
