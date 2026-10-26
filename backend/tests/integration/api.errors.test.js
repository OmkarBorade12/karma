// Integration tests for API error handling and profile validation:
// - unknown /api routes return structured JSON 404s (not HTML/500)
// - Mongoose validation surfaces as 400, never 500
// - profile updates never wipe stored values with empty strings

process.env.NODE_ENV = 'test';
process.env.KARMA_IN_MEMORY_DB = '1';

const request = require('supertest');
const { connectDb, disconnectDb } = require('../../src/config/db');
const { createApp } = require('../../src/app');
const { ensureSeeded } = require('../../src/services/bootstrap');

let app;

beforeAll(async () => {
  await connectDb(null, { inMemory: true });
  app = createApp();
  await ensureSeeded(); // profile exists from here on
});

afterAll(async () => {
  await disconnectDb();
});

describe('API error handling', () => {
  it('GET unknown /api route returns a JSON 404', async () => {
    const res = await request(app).get('/api/nonexistent-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No route/i);
  });

  it('POST unknown /api route returns a JSON 404', async () => {
    const res = await request(app).post('/api/documents/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No route/i);
  });
});

describe('profile validation', () => {
  it('POST /api/profile updates fields (alias of PUT)', async () => {
    const viaPost = await request(app).post('/api/profile').send({ name: 'Post Alias Name' });
    expect(viaPost.status).toBe(200);
    expect(viaPost.body.profile.name).toBe('Post Alias Name');

    const viaPut = await request(app).put('/api/profile').send({ name: 'Put Roundtrip' });
    expect(viaPut.status).toBe(200);
    expect(viaPut.body.profile.name).toBe('Put Roundtrip');

    const back = await request(app).get('/api/profile');
    expect(back.body.profile.name).toBe('Put Roundtrip');
  });

  it('rejects malformed email with 400', async () => {
    const res = await request(app).post('/api/profile').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('never wipes stored values with empty-string updates', async () => {
    const original = (await request(app).get('/api/profile')).body.profile;

    const res = await request(app).put('/api/profile').send({ summary: '', headline: 'Kept headline' });
    expect(res.status).toBe(200);
    expect(res.body.profile.summary).toBe(original.summary); // unchanged
    expect(res.body.profile.headline).toBe('Kept headline');

    // links merge: sending only github preserves other links
    const withLinks = await request(app).put('/api/profile').send({ links: { github: 'github.com/karma' } });
    expect(withLinks.status).toBe(200);
  });

  it('preserves a link that is not present in the update payload', async () => {
    await request(app).put('/api/profile').send({ links: { github: 'github.com/keeper', linkedin: 'linkedin.com/keeper' } });
    const res = await request(app).put('/api/profile').send({ links: { github: 'github.com/replacement' } });
    expect(res.status).toBe(200);
    const back = await request(app).get('/api/profile');
    expect(back.body.profile.links.github).toBe('github.com/replacement');
    expect(back.body.profile.links.linkedin).toBe('linkedin.com/keeper');
  });

  it('rejects fully empty payloads with 400', async () => {
    const res = await request(app).put('/api/profile').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no updatable fields/i);
  });
});

describe('document oversize validation returns 400 (not 500)', () => {
  it('rejects content beyond the schema maxlength with 400', async () => {
    const res = await request(app).post('/api/documents').send({
      title: 'Oversize note',
      content: 'x'.repeat(500001),
      sourceType: 'note',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });
});
