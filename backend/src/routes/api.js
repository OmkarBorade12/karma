// All REST routes for KARMA.

const express = require('express');

const router = express.Router();

const Document = require('../models/Document');
const Experience = require('../models/Experience');
const Profile = require('../models/Profile');
const Report = require('../models/Report');
const AgentRun = require('../models/AgentRun');
const { indexDocument, deindexDocument } = require('../services/ragIndex');
const { ask } = require('../services/askService');
const autopilot = require('../agent/autopilot');
const { ensureSeeded } = require('../services/bootstrap');
const { parseResume } = require('../services/profileParser');
const { renderExperienceAsText } = require('../agent/autopilot');
const { dbStateLabel } = require('../config/db');

// ── HEALTH ───────────────────────────────────────────────────────────────────

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    db: dbStateLabel(),
    autopilot: {
      scheduled: autopilot.scheduler.isScheduled(),
      running: autopilot.scheduler.isRunning(),
    },
    time: new Date().toISOString(),
  });
});

// ── PROFILE ──────────────────────────────────────────────────────────────────

router.get('/profile', async (req, res, next) => {
  try {
    const profile = await Profile.findOne({}).lean();
    res.json({ profile: profile || null });
  } catch (err) {
    next(err);
  }
});

// Shared profile upsert used by both routes. Intentionally skips empty strings
// so a partial update never wipes stored values.
async function updateProfile(req, res, next) {
  try {
    const { links } = req.body || {};
    const update = {};
    for (const key of ['name', 'headline', 'summary', 'email', 'location']) {
      if (typeof req.body?.[key] === 'string' && req.body[key].trim()) update[key] = req.body[key].trim();
    }
    if (links && typeof links === 'object') {
      const existing = await Profile.findOne({}).lean();
      update.links = {
        ...((existing && existing.links) || {}),
        ...(typeof links.github === 'string' ? { github: links.github.trim() } : {}),
        ...(typeof links.linkedin === 'string' ? { linkedin: links.linkedin.trim() } : {}),
        ...(typeof links.portfolio === 'string' ? { portfolio: links.portfolio.trim() } : {}),
      };
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }
    if (update.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(update.email)) {
      return res.status(400).json({ error: 'email is not a valid address' });
    }
    const profile = await Profile.findOneAndUpdate({}, { $set: update }, { new: true, upsert: true, runValidators: true }).lean();
    res.json({ profile });
  } catch (err) {
    next(err);
  }
}

// README's advertised route (POST /api/profile) plus the long-standing PUT.
router.post('/profile', updateProfile);
router.put('/profile', updateProfile);

// ── DOCUMENTS (ingest) ───────────────────────────────────────────────────────

router.get('/documents', async (req, res, next) => {
  try {
    const docs = await Document.find({}, 'title sourceType chunkCount autonomouslyGenerated metadata createdAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ documents: docs });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents
 * Body: { title, content, sourceType }
 * Integrates document ingestion with resume auto-parsing: if the parsed text
 * clearly looks like a resume (has headings + bullets), profile parsing is
 * offered in the response (not silently written — explicit POST /profile/parse).
 */
router.post('/documents', async (req, res, next) => {
  try {
    const { title, content, sourceType = 'note' } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required' });
    }
    if (!content || typeof content !== 'string' || content.trim().length < 10) {
      return res.status(400).json({ error: 'content is required (min 10 chars)' });
    }
    const allowed = ['resume', 'project', 'experience', 'note', 'certificate', 'qa', 'insight', 'seed'];
    if (!allowed.includes(sourceType)) {
      return res.status(400).json({ error: `sourceType must be one of: ${allowed.join(', ')}` });
    }

    const doc = await Document.create({ title: title.trim(), content, sourceType });
    const chunks = await indexDocument({
      documentId: doc._id,
      text: content,
      sourceTitle: doc.title,
      sourceType,
    });
    doc.chunkCount = chunks.length;
    await doc.save();
    res.status(201).json({ document: { ...doc.toObject() }, chunkCount: chunks.length });
  } catch (err) {
    next(err);
  }
});

router.delete('/documents/:id', async (req, res, next) => {
  try {
    const doc = await Document.findByIdAndDelete(req.params.id).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const deindexed = await deindexDocument(doc._id);
    res.json({ deleted: doc.title, chunksRemoved: deindexed });
  } catch (err) {
    next(err);
  }
});

// Parse a raw resume into structured profile + experiences (preview only).
router.post('/profile/parse', (req, res, next) => {
  try {
    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || content.trim().length < 20) {
      return res.status(400).json({ error: 'content is required (min 20 chars)' });
    }
    const parsed = parseResume(content);
    res.json(parsed);
  } catch (err) {
    next(err);
  }
});

// Commit a parsed resume: upsert profile + create experiences + index them.
router.post('/profile/parse/commit', async (req, res, next) => {
  try {
    const { content } = req.body || {};
    if (!content || typeof content !== 'string' || content.trim().length < 20) {
      return res.status(400).json({ error: 'content is required (min 20 chars)' });
    }
    const { profile: parsedProfile, experiences } = parseResume(content);
    if (!experiences.length) {
      return res.status(422).json({ error: 'Could not parse any experiences from the provided content' });
    }

    const profileUpdate = {};
    ['name', 'headline', 'summary', 'email', 'location'].forEach((k) => {
      if (parsedProfile[k]) profileUpdate[k] = parsedProfile[k];
    });
    const linkUpdate = {};
    for (const k of ['github', 'linkedin', 'portfolio']) {
      if (parsedProfile.links && parsedProfile.links[k]) linkUpdate[k] = parsedProfile.links[k];
    }
    if (Object.keys(linkUpdate).length) profileUpdate.links = linkUpdate;

    let profile = null;
    if (Object.keys(profileUpdate).length) {
      profile = await Profile.findOneAndUpdate({}, { $set: profileUpdate }, { new: true, upsert: true }).lean();
    }

    // Dedupe re-committed resumes: key a parsed entry by title+organization+startDate.
    const existingKeys = new Set(
      (await Experience.find({}, 'title organization startDate').lean()).map(
        (e) => `${e.title}||${e.organization || ''}||${e.startDate || ''}`
      )
    );
    const newExperiences = experiences.filter(
      (e) => !existingKeys.has(`${e.title}||${e.organization || ''}||${e.startDate || ''}`)
    );
    if (!newExperiences.length) {
      return res.status(409).json({ error: 'Resume already committed — all parsed experiences already exist', count: 0 });
    }

    const created = [];
    for (const e of newExperiences) {
      const entry = await Experience.create(e);
      const doc = await Document.create({
        title: e.title,
        content: renderExperienceAsText(entry.toObject()),
        sourceType: 'experience',
        metadata: { experienceId: String(entry._id), kind: entry.kind },
      });
      const chunks = await indexDocument({
        documentId: doc._id,
        text: doc.content,
        sourceTitle: doc.title,
        sourceType: 'experience',
      });
      await Document.updateOne({ _id: doc._id }, { chunkCount: chunks.length });
      created.push({ experience: e.title, chunks: chunks.length });
    }

    res.status(201).json({ profile, experiencesCreated: created, count: created.length });
  } catch (err) {
    next(err);
  }
});

// ── ASK (RAG) ────────────────────────────────────────────────────────────────

router.post('/ask', async (req, res, next) => {
  try {
    const { question, topK } = req.body || {};
    const result = await ask(question, { topK: Number.isFinite(topK) ? Math.min(Math.max(topK, 1), 20) : 5 });
    res.json(result);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// ── EXPERIENCE ───────────────────────────────────────────────────────────────

router.get('/experience', async (req, res, next) => {
  try {
    const entries = await Experience.find({}).sort({ startDate: -1, createdAt: -1 }).lean();

    const kindCounts = {};
    const skillFrequency = {};
    for (const e of entries) {
      kindCounts[e.kind] = (kindCounts[e.kind] || 0) + 1;
      for (const s of e.skills || []) {
        const k = s.toLowerCase().trim();
        if (k) skillFrequency[k] = (skillFrequency[k] || 0) + 1;
      }
    }
    const topSkills = Object.entries(skillFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill, count]) => ({ skill, count }));

    res.json({
      experiences: entries,
      analytics: { total: entries.length, kindCounts, topSkills },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/experience', async (req, res, next) => {
  try {
    const payload = req.body || {};
    if (!payload.title || typeof payload.title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    if (payload.kind && !['job', 'internship', 'project', 'education', 'certification', 'open-source', 'hackathon', 'personal'].includes(payload.kind)) {
      return res.status(400).json({ error: 'invalid kind' });
    }
    const entry = await Experience.create({
      title: payload.title,
      organization: payload.organization || '',
      kind: payload.kind || 'project',
      startDate: payload.startDate || null,
      endDate: payload.endDate || null,
      ongoing: Boolean(payload.ongoing),
      description: payload.description || '',
      skills: Array.isArray(payload.skills) ? payload.skills : [],
      highlights: Array.isArray(payload.highlights) ? payload.highlights : [],
      outcome: payload.outcome || '',
    });

    // Auto-index into RAG memory.
    const doc = await Document.create({
      title: entry.title,
      content: renderExperienceAsText(entry.toObject()),
      sourceType: 'experience',
      metadata: { experienceId: String(entry._id), kind: entry.kind },
    });
    const chunks = await indexDocument({
      documentId: doc._id,
      text: doc.content,
      sourceTitle: doc.title,
      sourceType: 'experience',
    });
    await Document.updateOne({ _id: doc._id }, { chunkCount: chunks.length });

    res.status(201).json({ experience: entry.toObject(), documentsCreated: 1, chunksIndexed: chunks.length });
  } catch (err) {
    next(err);
  }
});

// ── REPORTS ──────────────────────────────────────────────────────────────────

router.get('/reports', async (req, res, next) => {
  try {
    const { kind } = req.query;
    const filter = kind ? { kind } : {};
    const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ reports });
  } catch (err) {
    next(err);
  }
});

// ── AGENT RUNS ───────────────────────────────────────────────────────────────

router.get('/runs', async (req, res, next) => {
  try {
    const runs = await AgentRun.find({}).sort({ startedAt: -1 }).limit(30).lean();
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

// ── AUTOPILOT CONTROL ────────────────────────────────────────────────────────

router.post('/agent/run', async (req, res, next) => {
  try {
    if (req.body?.seed !== false) await ensureSeeded();
    const run = await autopilot.runCycle({ trigger: 'manual' });
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

router.post('/agent/autopilot/start', async (req, res, next) => {
  const cronExpr = req.body?.cron || process.env.KARMA_AUTOPILOT_CRON || '*/15 * * * *';
  try {
    const started = await autopilot.scheduler.startScheduled(cronExpr);
    res.json({ started, cron: cronExpr, message: started ? 'Autopilot scheduled.' : 'Autopilot already scheduled.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/agent/autopilot/stop', async (req, res, next) => {
  try {
    const stopped = autopilot.scheduler.stopScheduled();
    res.json({ stopped, message: stopped ? 'Autopilot stopped.' : 'Autopilot was not scheduled.' });
  } catch (err) {
    next(err);
  }
});

router.get('/agent/status', (req, res) => {
  res.json({ scheduled: autopilot.scheduler.isScheduled(), running: autopilot.scheduler.isRunning() });
});

module.exports = router;
