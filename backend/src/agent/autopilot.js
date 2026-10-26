// ─────────────────────────────────────────────────────────────────────────────
// KARMA AUTOPILOT — the autonomous core.
//
// Continuous DDA cycle, no human in the loop:
//   DISCOVER — analyze the memory index and experience corpus to find gaps
//              (un-narrated experiences, evidence-free skills, weak retrieval).
//   DIGEST   — autonomously generate insight reports (skill-gap, trajectory,
//              retrieval-quality) and interview-style Q&A pairs.
//   AUGMENT  — write the generated knowledge back into the RAG index so every
//              future cycle retrieves better than the last (self-improving).
//
// Every cycle is recorded as an AgentRun with per-step timings and stats.
// ─────────────────────────────────────────────────────────────────────────────

const Document = require('../models/Document');
const Chunk = require('../models/Chunk');
const Experience = require('../models/Experience');
const Profile = require('../models/Profile');
const Report = require('../models/Report');
const AgentRun = require('../models/AgentRun');
const { indexDocument, deindexDocument, loadCorpus } = require('../services/ragIndex');
const { retrieve } = require('../rag/retriever');

// Target capability profile for an "AIML + MERN + RAG engineer" — used by the
// skill-gap analyzer to quantify coverage vs. where the corpus claims to be.
const TARGET_CAPABILITIES = [
  'python', 'numpy', 'pandas', 'scikit-learn', 'tensorflow', 'pytorch',
  'react', 'node', 'express', 'mongodb', 'mongoose', 'rest',
  'rag', 'embeddings', 'bm25', 'tf-idf', 'chunking', 'reranking',
  'docker', 'git', 'testing', 'jwt', 'deployment', 'sql', 'apis', 'machine learning', 'model evaluation',
];

async function timed(fn) {
  const t0 = Date.now();
  const out = await fn();
  return { out, durationMs: Date.now() - t0 };
}

// ── DISCOVER ─────────────────────────────────────────────────────────────────

async function discover() {
  const [corpus, experiences, profile, existingQaDocs] = await Promise.all([
    loadCorpus(),
    Experience.find({}).sort({ startDate: -1, createdAt: -1 }).lean(),
    Profile.findOne({}).lean(),
    Document.countDocuments({ sourceType: 'qa' }).lean(),
  ]);

  const corpusText = corpus.map((c) => c.text).join('\n').toLowerCase();

  // Gap 1: skills claimed in experience entries that have no corpus evidence.
  const skillSet = new Set();
  for (const e of experiences) (e.skills || []).forEach((s) => skillSet.add(s));
  const uncoveredSkills = [...skillSet].filter((s) => !corpusText.includes(String(s).toLowerCase()));

  // Gap 2: target capabilities not present anywhere.
  const missingCapabilities = TARGET_CAPABILITIES.filter((c) => !corpusText.includes(c));

  // Gap 3: experiences that were never rendered into an indexed source document.
  const experienceDocs = await Document.find(
    { sourceType: 'experience' },
    'title metadata.experienceId'
  ).lean();
  const indexedExperienceIds = new Set(experienceDocs.map((d) => String(d.metadata?.experienceId || '')));
  const unindexedExperiences = experiences.filter((e) => !indexedExperienceIds.has(String(e._id)));

  // Gap 4: no interview QA pairs generated yet.
  const needsQaGeneration = existingQaDocs < Math.ceil(experiences.length / 2);

  // Gap 5: retrieval health probes.
  const probes = buildProbes(experiences, profile);
  const probeResults = probeRetrieval(corpus, probes);

  return {
    corpusSize: corpus.length,
    experienceCount: experiences.length,
    hasProfile: Boolean(profile),
    uncoveredSkills,
    missingCapabilities,
    unindexedExperiences,
    needsQaGeneration,
    probes,
    probeResults,
    experiences,
    profile,
  };
}

// Probe questions the agent self-tests retrieval against (from its own data).
function buildProbes(experiences, profile, max = 5) {
  const probes = [];
  const seen = new Set();
  for (const e of experiences) {
    for (const s of (e.skills || []).slice(0, 2)) {
      if (seen.has(s)) continue;
      seen.add(s);
      probes.push(`What experience do I have with ${s}?`);
      if (probes.length >= max) return probes;
    }
  }
  if (profile && profile.name && seen.size < max) {
    probes.push('Who am I and what is my professional background?');
  }
  return probes.slice(0, max);
}

function probeRetrieval(corpus, probes) {
  return probes.map((q) => {
    const hits = retrieve(q, corpus, { topK: 3 });
    const coverage = hits.length
      ? hits.reduce((s, h) => s + (h.coverage ?? 0), 0) / hits.length
      : 0;
    const healthy = hits.length > 0 && coverage >= 0.25;
    return { question: q, hits: hits.length, coverage, healthy };
  });
}

// ── DIGEST ───────────────────────────────────────────────────────────────────

function renderExperienceAsText(e) {
  const lines = [
    `title: ${e.title}`,
    e.organization ? `organization: ${e.organization}` : null,
    `type: ${e.kind}${e.ongoing ? ' (ongoing)' : ''}`,
    e.description ? `project: ${e.description}` : null,
    (e.highlights || []).length ? `highlights:\n${(e.highlights || []).map((h) => `- ${h}`).join('\n')}` : null,
    (e.skills || []).length ? `skills: ${(e.skills || []).join(', ')}` : null,
    e.outcome ? `outcome: ${e.outcome}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatDate(d) {
  if (!d) return null;
  return new Date(d).toISOString().slice(0, 10);
}

async function digest(discovery) {
  const reports = [];

  // 1) Skill-gap report: corpus-observed strengths vs target capability profile.
  const corpusText = (await loadCorpus()).map((c) => c.text).join('\n').toLowerCase();
  const observed = TARGET_CAPABILITIES.filter((c) => corpusText.includes(c));
  const coveragePct = Math.round((observed.length / TARGET_CAPABILITIES.length) * 100);
  reports.push(
    await Report.create({
      kind: 'skill-gap',
      title: `Skill-gap analysis vs AIML+MERN+RAG target profile (${coveragePct}% coverage)`,
      summary:
        `The memory index currently evidences ${observed.length}/${TARGET_CAPABILITIES.length} target capabilities. ` +
        (discovery.missingCapabilities.length
          ? `No evidence found for: ${discovery.missingCapabilities.join(', ')}.`
          : 'All target capabilities are evidenced in the experience corpus.'),
      body: {
        observed,
        missing: discovery.missingCapabilities,
        uncoveredDeclaredSkills: discovery.uncoveredSkills,
        advice: discovery.missingCapabilities.slice(0, 4).length
          ? `Next best additions to the experience corpus: ${discovery.missingCapabilities.slice(0, 4).join(', ')}`
          : 'Coverage is complete for the current target profile.',
      },
      metrics: { coveragePct, observedCount: observed.length, targetCount: TARGET_CAPABILITIES.length },
      derivedFrom: [],
    })
  );

  // 2) Trajectory report: timeline + frequency analytics over experiences.
  const kindCounts = {};
  const skillFrequency = {};
  for (const e of discovery.experiences) {
    kindCounts[e.kind] = (kindCounts[e.kind] || 0) + 1;
    for (const s of e.skills || []) skillFrequency[s.toLowerCase()] = (skillFrequency[s.toLowerCase()] || 0) + 1;
  }
  const topSkills = Object.entries(skillFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([skill, count]) => ({ skill, count }));
  const dateSpans = discovery.experiences
    .filter((e) => e.startDate)
    .map((e) => formatDate(e.startDate))
    .sort();
  reports.push(
    await Report.create({
      kind: 'trajectory',
      title: `Experience trajectory overview (${discovery.experiences.length} entries)`,
      summary:
        `Distribution by type: ${Object.entries(kindCounts).map(([k, n]) => `${k} × ${n}`).join(', ') || 'no entries'}. ` +
        `Core recurring skills: ${topSkills.slice(0, 5).map((t) => t.skill).join(', ')}.`,
      body: { kindCounts, topSkills, earliestEntry: dateSpans[0] || null, latestEntry: dateSpans[dateSpans.length - 1] || null },
      metrics: { entryCount: discovery.experiences.length },
      derivedFrom: discovery.experiences.map((e) => e._id),
    })
  );

  // 3) Retrieval-quality self-evaluation report.
  const healthyProbes = discovery.probeResults.filter((p) => p.healthy).length;
  const avgCoverage = discovery.probeResults.length
    ? discovery.probeResults.reduce((s, p) => s + p.coverage, 0) / discovery.probeResults.length
    : 0;
  reports.push(
    await Report.create({
      kind: 'retrieval-quality',
      title: `Retrieval self-evaluation (${healthyProbes}/${discovery.probeResults.length} probes healthy)`,
      summary:
        `The autopilot probed its own retriever with ${discovery.probeResults.length} questions derived from the corpus. ` +
        `Average query-term coverage: ${(avgCoverage * 100).toFixed(0)}%.`,
      body: { probes: discovery.probeResults },
      metrics: { healthyProbes, totalProbes: discovery.probeResults.length, avgCoverage },
      derivedFrom: [],
    })
  );

  return { reports };
}

// Interview-style Q&A generation: templates over real experience facts.
function generateQaPairs(experiences, { max = 6 } = {}) {
  const pairs = [];
  const pick = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);

  for (const e of experiences) {
    if (pairs.length >= max) break;
    const skill = pick(e.skills || []);
    const highlight = pick(e.highlights || []);
    if (skill && highlight) {
      pairs.push({
        question: `Tell me about your work with ${skill}.`,
        answer: highlight,
        source: e.title,
      });
    }
  }
  for (const e of experiences.slice(0, Math.max(1, max - pairs.length))) {
    if (pairs.length >= max) break;
    pairs.push({
      question: `Describe the "${e.title}" ${e.kind}.`,
      answer: e.description || ((e.highlights || [])[0] || '').toString(),
      source: e.title,
    });
  }
  return pairs.filter((p) => p.answer);
}

// ── AUGMENT ──────────────────────────────────────────────────────────────────

async function augment(discovery, { qaPairs }) {
  let documentsAugmented = 0;
  let chunksIndexed = 0;

  // A) Index any experiences that were not yet in the RAG corpus.
  for (const e of discovery.unindexedExperiences) {
    const doc = await Document.create({
      title: `Experience: ${e.title}`,
      content: renderExperienceAsText(e),
      sourceType: 'experience',
      metadata: { experienceId: String(e._id), kind: e.kind },
    });
    const chunks = await indexDocument({
      documentId: doc._id,
      text: doc.content,
      sourceTitle: doc.title,
      sourceType: 'experience',
    });
    await Document.updateOne({ _id: doc._id }, { chunkCount: chunks.length });
    chunksIndexed += chunks.length;
    documentsAugmented += 1;
  }

  // B) Write interview Q&A pairs into the index (self-augmentation).
  //    Gated: only when discovery says generation is due, and updated in place
  //    instead of duplicated so scheduled cycles don't inflate the index.
  const pairs = (qaPairs || []).filter((p) => p && p.answer);
  if (discovery.needsQaGeneration && pairs.length) {
    const content = pairs.map((p) => `Q: ${p.question}\nA: ${p.answer}\n(source: ${p.source})`).join('\n\n');
    const existing = await Document.findOne({ title: 'Interview Preparation Q&A', sourceType: 'qa' });
    let doc;
    if (existing && existing.content === content) {
      doc = null; // identical QA set already covered — no-op
    } else if (existing) {
      // experience set changed: replace content in place, reindex
      await deindexDocument(existing._id);
      const chunks = await indexDocument({
        documentId: existing._id,
        text: content,
        sourceTitle: existing.title,
        sourceType: 'qa',
      });
      await Document.updateOne(
        { _id: existing._id },
        {
          content,
          chunkCount: chunks.length,
          metadata: { ...(existing.metadata || {}), generatedBy: 'autopilot', pairCount: pairs.length },
        }
      );
      chunksIndexed += chunks.length;
      doc = null;
    } else {
      doc = await Document.create({
        title: 'Interview Preparation Q&A',
        content,
        sourceType: 'qa',
        autonomouslyGenerated: true,
        metadata: { generatedBy: 'autopilot', pairCount: pairs.length },
      });
      documentsAugmented += 1;
    }
    if (doc) {
      const chunks = await indexDocument({
        documentId: doc._id,
        text: doc.content,
        sourceTitle: doc.title,
        sourceType: 'qa',
      });
      await Document.updateOne({ _id: doc._id }, { chunkCount: chunks.length });
      chunksIndexed += chunks.length;
    }
  }

  // C) Evidence notes for skills declared but missing corpus evidence —
  //    a hybrid index enrichment so future queries on those skills retrieve
  //    their associated experiences.
  if (discovery.uncoveredSkills.length) {
    const evidenceLines = [];
    for (const e of discovery.experiences) {
      for (const s of e.skills || []) {
        if (discovery.uncoveredSkills.includes(s)) {
          evidenceLines.push(
            `Evidence for ${s}: ${e.title} (${e.kind}${e.organization ? `, ${e.organization}` : ''}). Details: ${e.description || (e.highlights || []).join('; ')}`
          );
        }
      }
    }
    if (evidenceLines.length) {
      const content = evidenceLines.join('\n\n');
      const existingDoc = await Document.findOne({ title: 'Skill-Evidence Notes (autopilot enrichment)', sourceType: 'insight' });
      let doc;
      if (existingDoc && existingDoc.content === content) {
        doc = null; // identical evidence already indexed — no-op
      } else if (existingDoc) {
        await deindexDocument(existingDoc._id);
        const chunks = await indexDocument({
          documentId: existingDoc._id,
          text: content,
          sourceTitle: existingDoc.title,
          sourceType: 'insight',
        });
        await Document.updateOne(
          { _id: existingDoc._id },
          {
            content,
            chunkCount: chunks.length,
            metadata: { ...(existingDoc.metadata || {}), generatedBy: 'autopilot', skillCount: discovery.uncoveredSkills.length },
          }
        );
        chunksIndexed += chunks.length;
        doc = null;
      } else {
        doc = await Document.create({
          title: 'Skill-Evidence Notes (autopilot enrichment)',
          content,
          sourceType: 'insight',
          autonomouslyGenerated: true,
          metadata: { generatedBy: 'autopilot', skillCount: discovery.uncoveredSkills.length },
        });
        documentsAugmented += 1;
      }
      if (doc) {
        const chunks = await indexDocument({
          documentId: doc._id,
          text: doc.content,
          sourceTitle: doc.title,
          sourceType: 'insight',
        });
        await Document.updateOne({ _id: doc._id }, { chunkCount: chunks.length });
        chunksIndexed += chunks.length;
      }
    }
  }

  return { documentsAugmented, chunksIndexed };
}

// ── CYCLE ────────────────────────────────────────────────────────────────────

async function runCycle({ trigger = 'manual', phases: phaseOverrides = {} } = {}) {
  // Phase implementations are injectable so tests can fault-in without
  // monkey-patching module internals.
  const phaseDiscover = phaseOverrides.discover ?? discover;
  const phaseDigest = phaseOverrides.digest ?? digest;
  const phaseAugment = phaseOverrides.augment ?? augment;
  const run = await AgentRun.create({ trigger });
  const t0 = Date.now();
  const errors = [];
  let stats = { chunksIndexed: 0, reportsCreated: 0, documentsAugmented: 0, questionsEvaluated: 0 };
  let currentPhase = 'discover'; // recorded when a phase throws

  const pushStep = (phase, action, detail, success = true, durationMs = 0) =>
    run.steps.push({ phase, action, detail, success, durationMs });

  try {
    // DISCOVER
    currentPhase = 'discover';
    const discoverResult = await timed(() => phaseDiscover());
    if (discoverResult.out.hasProfile === false) errors.push('No profile present in database.');
    pushStep(
      'discover',
      `Analyzed index (${discoverResult.out.corpusSize} chunks) and ${discoverResult.out.experienceCount} experience entries`,
      {
        uncoveredSkills: discoverResult.out.uncoveredSkills.length,
        unindexedExperiences: discoverResult.out.unindexedExperiences.length,
        probes: discoverResult.out.probeResults.length,
      },
      true,
      discoverResult.durationMs
    );
    await run.save();
    stats.questionsEvaluated = discoverResult.out.probeResults.length;

    // DIGEST
    currentPhase = 'digest';
    const qaPairs = generateQaPairs(discoverResult.out.experiences);
    const digestResult = await timed(() => phaseDigest(discoverResult.out));
    pushStep(
      'digest',
      `Generated ${digestResult.out.reports.length} insight reports + ${qaPairs.length} interview Q&A pairs`,
      { reportKinds: digestResult.out.reports.map((r) => r.kind), qaPairs: qaPairs.length },
      true,
      digestResult.durationMs
    );
    await run.save();

    // AUGMENT
    currentPhase = 'augment';
    const augmentResult = await timed(() => phaseAugment(discoverResult.out, { qaPairs }));
    pushStep(
      'augment',
      `Indexed ${augmentResult.out.chunksIndexed} new chunks across ${augmentResult.out.documentsAugmented} self-authored sources`,
      augmentResult.out,
      true,
      augmentResult.durationMs
    );
    stats.chunksIndexed = augmentResult.out.chunksIndexed;
    stats.documentsAugmented = augmentResult.out.documentsAugmented;
    stats.reportsCreated = digestResult.out.reports.length;
  } catch (err) {
    errors.push(err.message);
    // Record the failing phase so run.steps never show a silently-missing one.
    try {
      pushStep(currentPhase, `phase failed: ${currentPhase}`, { error: err.message }, false);
      await run.save();
    } catch {
      // run.save() failing here must not mask the original error
    }
    // eslint-disable-next-line no-console
    console.error('[karma][autopilot] cycle error:', err);
  }

  run.stats = stats;
  run.issues = errors;
  run.status = errors.length && stats.reportsCreated ? 'partial' : errors.length ? 'failed' : 'success';
  run.finishedAt = new Date();
  run.durationMs = Date.now() - t0;
  await run.save();

  return run.toObject();
}

// ── SCHEDULER ────────────────────────────────────────────────────────────────

const cron = require('node-cron');

const state = { scheduled: null, running: false };

function isRunning() {
  return state.running;
}

function isScheduled() {
  return Boolean(state.scheduled);
}

async function startScheduled(cronExpr) {
  if (state.scheduled) return false;
  if (!cron.validate(cronExpr)) {
    const err = new Error(`Invalid cron expression: ${cronExpr}`);
    err.status = 400;
    throw err;
  }
  state.scheduled = cron.schedule(cronExpr, async () => {
    if (state.running) return; // never overlap cycles
    state.running = true;
    try {
      await runCycle({ trigger: 'schedule' });
    } finally {
      state.running = false;
    }
  });
  return true;
}

function stopScheduled() {
  if (!state.scheduled) return false;
  state.scheduled.stop();
  state.scheduled = null;
  return true;
}

module.exports = {
  runCycle,
  discover,
  digest,
  augment,
  generateQaPairs,
  renderExperienceAsText,
  targetCapabilities: TARGET_CAPABILITIES,
  scheduler: { startScheduled, stopScheduled, isScheduled, isRunning },
};
