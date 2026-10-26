// Boot-time seeding: on first run with an empty DB, KARMA installs the baseline
// experience profile so the autopilot has something to reason over. Idempotent.

const Document = require('../models/Document');
const Experience = require('../models/Experience');
const Profile = require('../models/Profile');
const { indexDocument } = require('./ragIndex');
const { renderExperienceAsText } = require('../agent/autopilot');
const { SEED_PROFILE, SEED_EXPERIENCES } = require('../data/seedExperience');

async function ensureSeeded() {
  const existing = await Document.countDocuments({});
  if (existing > 0) return { seeded: false, reason: 'already-populated' };

  const docsCreated = [];

  if (!(await Profile.countDocuments({}))) {
    await Profile.create({ ...SEED_PROFILE });
    if (!SEED_PROFILE.name || SEED_PROFILE.name === 'Your Name') {
      // eslint-disable-next-line no-console
      console.warn(
        '[karma] seed profile is still a placeholder — edit backend/src/data/seedExperience.js with your real details, ' +
          'or paste your resume through the dashboard Ingest tab to replace it.'
      );
    }
  }

  let chunkTotal = 0;
  for (const seed of SEED_EXPERIENCES) {
    const entry = await Experience.create({ ...seed });
    const doc = await Document.create({
      title: seed.title,
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
    chunkTotal += chunks.length;
    docsCreated.push(doc.title);
  }

  return { seeded: true, documents: docsCreated.length, chunks: chunkTotal };
}

module.exports = { ensureSeeded };
