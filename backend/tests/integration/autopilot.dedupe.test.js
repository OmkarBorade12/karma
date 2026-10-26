// Integration tests for autopilot self-augmentation guarantees:
// - repeated cycles must NOT duplicate the QA / evidence documents
// - changed experiences must update the QA document in place
// - a failing phase must be recorded in run.steps
// - the version-cached corpus must reflect newly indexed documents

process.env.NODE_ENV = 'test';
process.env.KARMA_IN_MEMORY_DB = '1';

const request = require('supertest');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const { ensureSeeded } = require('../../src/services/bootstrap');
const autopilot = require('../../src/agent/autopilot');
const Document = require('../../src/models/Document');
const Experience = require('../../src/models/Experience');

let app;

beforeAll(async () => {
  await connectDb(null, { inMemory: true });
  app = createApp();
  await ensureSeeded();
});

afterAll(async () => {
  autopilot.scheduler.stopScheduled();
  await disconnectDb();
});

describe('autopilot self-augmentation idempotence', () => {
  it('does not duplicate the QA document across repeated cycles', async () => {
    const run1 = await autopilot.runCycle({ trigger: 'manual' });
    expect(run1.status).toBe('success');

    const after1 = await Document.countDocuments({ sourceType: 'qa' });
    expect(after1).toBe(1);

    const run2 = await autopilot.runCycle({ trigger: 'manual' });
    expect(run2.status).toBe('success');

    const after2 = await Document.countDocuments({ sourceType: 'qa' });
    expect(after2).toBe(1); // previously grew by 1 per cycle (unbounded)
  });

  it('updates the QA document in place when experiences change', async () => {
    await Experience.create({
      title: 'Extra Matrix Ops',
      kind: 'project',
      description: 'Practised matrix algebra and eigen decompositions for gradient descent stability.',
      skills: ['linear algebra', 'eigen-decomposition'],
      highlights: ['Derived eigenvalue bounds for learning-rate tuning.'],
    });

    const run3 = await autopilot.runCycle({ trigger: 'manual' });
    expect(run3.status).toBe('success');

    const qaDocs = await Document.find({ sourceType: 'qa' });
    expect(qaDocs).toHaveLength(1); // updated, not duplicated
    expect(qaDocs[0].metadata.pairCount).toBeGreaterThan(0);

    // The corpus cache should now reflect the newly indexed experience.
    const ask = await request(app).post('/api/ask').send({ question: 'linear algebra eigen decompositions gradient descent' });
    expect(ask.status).toBe(200);
    const references = JSON.stringify(ask.body.references) + ask.body.answer;
    expect(references).toMatch(/Matrix|linear algebra|eigen/i);
  });

  it('records the failing phase in run.steps when a phase throws', async () => {
    const run = await autopilot.runCycle({
      trigger: 'manual',
      phases: {
        digest: () => {
          throw new Error('boom digest');
        },
      },
    });
    expect(run.status).toBe('failed');
    const failedStep = run.steps.find((s) => !s.success);
    expect(failedStep).toBeTruthy();
    expect(failedStep.phase).toBe('digest');
    expect(failedStep.detail.error).toMatch(/boom digest/i);
  });

  it('health endpoint reports the connected database state', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.db).toBe('connected');
  });
});
