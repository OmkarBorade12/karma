// Integration tests: full API lifecycle over an in-memory MongoDB.
// Covers: health, seeding, profile, document ingest (with auto-indexing),
// resume parse + commit, RAG ask flow, experience CRUD, autopilot run cycle,
// reports, agent runs, autopilot control, deletion, validation errors.

process.env.NODE_ENV = 'test';
process.env.KARMA_IN_MEMORY_DB = '1';

const request = require('supertest');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const { ensureSeeded } = require('../../src/services/bootstrap');
const autopilot = require('../../src/agent/autopilot');

let app;

const RESUME_TEXT = [
  'Alex Sharma',
  'MERN + AIML developer',
  'alex.sharma@example.com | github.com/alexsharma',
  '',
  'PROJECTS',
  'LinguaSwift Translator (2023 - 2024)',
  '- Built a translation app in React with an Express API backed by MongoDB.',
  '- Deployed on Vercel with CI from GitHub Actions.',
  '',
  'SKILLS',
  'React, Node.js, Express, MongoDB, Python, TF-IDF, testing, git',
].join('\n');

beforeAll(async () => {
  await connectDb(null, { inMemory: true });
  app = createApp();
  // Seed up-front so every describe is order-independent.
  await ensureSeeded();
});

afterAll(async () => {
  autopilot.scheduler.stopScheduled();
  await disconnectDb();
});

describe('health & bootstrap', () => {
  it('GET /api/health reports ok + autopilot status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.autopilot).toHaveProperty('scheduled');
    expect(res.body.autopilot).toHaveProperty('running');
  });

  it('ensureSeeded is idempotent on an already-populated DB', async () => {
    const second = await ensureSeeded();
    expect(second.seeded).toBe(false);
  });
});

describe('profile endpoints', () => {
  it('GET /api/profile returns the seeded profile', async () => {
    const res = await request(app).get('/api/profile');
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeTruthy();
    expect(res.body.profile).toHaveProperty('name');
  });

  it('PUT /api/profile updates fields', async () => {
    const res = await request(app).put('/api/profile').send({ name: 'Updated Name', location: 'Pune' });
    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe('Updated Name');

    const back = await request(app).get('/api/profile');
    expect(back.body.profile.location).toBe('Pune');
  });

  it('PUT /api/profile rejects empty payloads', async () => {
    const res = await request(app).put('/api/profile').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No updatable fields/i);
  });
});

describe('document ingestion -> RAG', () => {
  it('POST /api/documents ingests + chunks content', async () => {
    const res = await request(app).post('/api/documents').send({
      title: 'Internship at NeuraWorks',
      content:
        'Internship at NeuraWorks (2025).\n- Worked on a data pipeline in Python for cleaning the training data of the image classification model.\n- Built an internal dashboard for the API metrics in React.',
      sourceType: 'experience',
    });
    expect(res.status).toBe(201);
    expect(res.body.document.chunkCount).toBeGreaterThan(0);
    expect(res.body.chunkCount).toBe(res.body.document.chunkCount);
  });

  it('validates title/content/sourceType', async () => {
    const noTitle = await request(app).post('/api/documents').send({ content: 'Valid content here' });
    expect(noTitle.status).toBe(400);

    const shortContent = await request(app).post('/api/documents').send({ title: 'T', content: 'tiny' });
    expect(shortContent.status).toBe(400);

    const badType = await request(app)
      .post('/api/documents')
      .send({ title: 'T', content: 'Valid content here', sourceType: 'bogus' });
    expect(badType.status).toBe(400);
  });

  it('POST /api/ask answers from ingested experience with citations', async () => {
    const res = await request(app).post('/api/ask').send({ question: 'What pipeline work did I do in Python?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/pipeline/i);
    expect(res.body.references.length).toBeGreaterThan(0);
    expect(res.body.metrics.corpusSize).toBeGreaterThan(0);
  });

  it('POST /api/ask rejects empty question', async () => {
    const res = await request(app).post('/api/ask').send({ question: '  ' });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/documents/:id removes doc + deindexes chunks', async () => {
    const docs = await request(app).get('/api/documents');
    const doc = docs.body.documents.find((d) => d.title === 'Internship at NeuraWorks');
    expect(doc).toBeTruthy();
    const before = await request(app).get('/api/health'); // sanity
    expect(before.status).toBe(200);

    const del = await request(app).delete(`/api/documents/${doc._id}`);
    expect(del.status).toBe(200);
    expect(del.body.chunksRemoved).toBeGreaterThan(0);

    const after = await request(app).post('/api/ask').send({ question: 'NeuraWorks internship data pipeline' });
    expect(after.status).toBe(200);
    // retrieved text should no longer mention the deleted source
    expect(JSON.stringify(after.body.references)).not.toContain('NeuraWorks');
  });
});

describe('resume parsing API', () => {
  it('POST /api/profile/parse returns structured preview without writing', async () => {
    const res = await request(app).post('/api/profile/parse').send({ content: RESUME_TEXT });
    expect(res.status).toBe(200);
    expect(res.body.profile.name).toBe('Alex Sharma');
    expect(res.body.experiences.length).toBeGreaterThan(0);
    // nothing written yet (preview only)
  });

  it('POST /api/profile/parse rejects short content', async () => {
    const res = await request(app).post('/api/profile/parse').send({ content: 'short' });
    expect(res.status).toBe(400);
  });

  it('POST /api/profile/parse/commit persists profile + experiences + indexes them', async () => {
    const res = await request(app).post('/api/profile/parse/commit').send({ content: RESUME_TEXT });
    expect(res.status).toBe(201);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.experiencesCreated[0].chunks).toBeGreaterThan(0);

    const askRes = await request(app).post('/api/ask').send({ question: 'Tell me about LinguaSwift Translator project' });
    expect(askRes.status).toBe(200);
    expect(JSON.stringify(askRes.body.answer + JSON.stringify(askRes.body.references))).toMatch(/LinguaSwift/i);

    const exp = await request(app).get('/api/experience');
    expect(exp.body.experiences.some((e) => /LinguaSwift/i.test(e.title))).toBe(true);
  });

  it('POST /api/profile/parse/commit is idempotent (dedupe on re-commit)', async () => {
    const res = await request(app).post('/api/profile/parse/commit').send({ content: RESUME_TEXT });
    expect(res.status).toBe(409);
    expect(res.body.count).toBe(0);
    expect(res.body.error).toMatch(/already committed/i);

    const exp = await request(app).get('/api/experience');
    const lingua = exp.body.experiences.filter((e) => /LinguaSwift/i.test(e.title));
    expect(lingua).toHaveLength(1); // still exactly one entry
  });

  it('POST /api/profile/parse/commit returns 422 when nothing parses', async () => {
    const res = await request(app).post('/api/profile/parse/commit').send({
      content: 'A quiet diary entry about weather observations and errands, with no resume structure at all.',
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/could not parse/i);
  });
});

describe('experience analytics', () => {
  it('GET /api/experience returns entries + analytics', async () => {
    const res = await request(app).get('/api/experience');
    expect(res.status).toBe(200);
    expect(res.body.analytics.total).toBeGreaterThan(0);
    expect(res.body.analytics.topSkills.length).toBeGreaterThan(0);
    expect(res.body.analytics.kindCounts['project']).toBeGreaterThan(0);
  });

  it('POST /api/experience creates + auto-indexes an entry', async () => {
    const res = await request(app).post('/api/experience').send({
      title: 'ZkBoard Cryptography Project',
      kind: 'project',
      description: 'Built a zk-proof demo board with Node backend and WebCrypto signatures.',
      skills: ['cryptography', 'node', 'webcrypto'],
    });
    expect(res.status).toBe(201);
    expect(res.body.documentsCreated).toBe(1);

    const askRes = await request(app).post('/api/ask').send({ question: 'cryptography webcrypto proof board experience?' });
    expect(JSON.stringify(askRes.body.answer + JSON.stringify(askRes.body.references))).toMatch(/ZkBoard/i);
  });

  it('POST /api/experience validates title and kind', async () => {
    const noTitle = await request(app).post('/api/experience').send({ description: 'x' });
    expect(noTitle.status).toBe(400);

    const badKind = await request(app).post('/api/experience').send({ title: 'T', kind: 'gig' });
    expect(badKind.status).toBe(400);
  });
});

describe('autopilot lifecycle', () => {
  it('POST /api/agent/run executes a full DDA cycle and records run', async () => {
    const res = await request(app).post('/api/agent/run');
    expect(res.status).toBe(200);
    const { run } = res.body;
    expect(run.status).toBe('success');
    expect(run.trigger).toBe('manual');
    const phases = run.steps.map((s) => s.phase);
    expect(phases).toEqual(['discover', 'digest', 'augment']);
    expect(run.stats.reportsCreated).toBeGreaterThan(0);
    expect(run.durationMs).toBeGreaterThan(0);
  });

  it('second run is also successful (idempotent autopilot)', async () => {
    const res = await request(app).post('/api/agent/run');
    expect(res.body.run.status).toBe('success');
  });

  it('GET /api/reports lists generated reports with kinds', async () => {
    const res = await request(app).get('/api/reports');
    expect(res.status).toBe(200);
    const kinds = new Set(res.body.reports.map((r) => r.kind));
    expect(kinds.has('skill-gap')).toBe(true);
    expect(kinds.has('trajectory')).toBe(true);
    expect(kinds.has('retrieval-quality')).toBe(true);
  });

  it('GET /api/reports filters by kind', async () => {
    const res = await request(app).get('/api/reports?kind=skill-gap');
    expect(res.body.reports.length).toBeGreaterThan(0);
    for (const r of res.body.reports) expect(r.kind).toBe('skill-gap');
  });

  it('GET /api/runs lists run history', async () => {
    const res = await request(app).get('/api/runs');
    expect(res.status).toBe(200);
    expect(res.body.runs.length).toBeGreaterThan(0);
  });

  it('autopilot control: start -> status -> stop', async () => {
    const start = await request(app).post('/api/agent/autopilot/start').send({ cron: '*/30 * * * *' });
    expect(start.status).toBe(200);
    expect(start.body.started).toBe(true);

    const again = await request(app).post('/api/agent/autopilot/start').send({ cron: '*/30 * * * *' });
    expect(again.body.started).toBe(false);

    const status = await request(app).get('/api/agent/status');
    expect(status.body.scheduled).toBe(true);

    const stop = await request(app).post('/api/agent/autopilot/stop');
    expect(stop.body.stopped).toBe(true);
  });

  it('rejects invalid cron expression', async () => {
    const res = await request(app).post('/api/agent/autopilot/start').send({ cron: 'not a cron' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid cron/i);
  });
});

describe('RAG quality gates (integration level)', () => {
  it('answers skill questions about the seeded corpus', async () => {
    const res = await request(app).post('/api/ask').send({ question: 'What skills do I have in machine learning?' });
    expect(res.body.confidence).toBeGreaterThan(0);
    expect(res.body.answer).toMatch(/python|numpy|pandas|scikit/i);
  });

  it('handles out-of-corpus questions gracefully', async () => {
    const res = await request(app).post('/api/ask').send({ question: 'What is my experience with quantum teleportation?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBeTruthy();
  });
});
