const { synthesize, detectIntent, scoreUnit, toUnits } = require('../../src/rag/synthesizer');
const { tokenize } = require('../../src/rag/tokenizer');

const HITS = [
  {
    id: '1',
    text: 'Built a full-stack MERN application with React, Node.js, Express and MongoDB including REST APIs and authentication.\n- skills: React, Node.js, Express, MongoDB',
    heading: 'Full-Stack MERN development practice',
    sourceType: 'experience',
    sourceTitle: 'Full-Stack MERN development practice',
    rerankScore: 0.8,
    coverage: 0.8,
  },
  {
    id: '2',
    text: 'Implemented a summary retrieval pipeline for grounded answers with citations.',
    heading: 'RAG study',
    sourceType: 'experience',
    sourceTitle: 'RAG and intelligent-systems study',
    rerankScore: 0.5,
    coverage: 0.3,
  },
];

describe('synthesizer', () => {
  it('produces a cited answer with references', () => {
    const out = synthesize('What projects did I build with React and MongoDB?', HITS);
    expect(out.answer).toContain('[1]');
    expect(out.references.length).toBe(2);
    expect(out.references[0]).toMatchObject({ n: 1, sourceTitle: HITS[0].sourceTitle, sourceType: 'experience' });
    expect(out.confidence).toBeGreaterThan(0);
    expect(out.metrics.unitsUsed).toBeGreaterThan(0);
  });

  it('puts matching intent-first-selected unit early in the answer', () => {
    const out = synthesize('What technical skills do I have?', HITS, { maxUnits: 4 });
    // first body line should cite [1] (skills line lives in chunk 1)
    expect(out.answer.split('\n')[1]).toContain('[1]');
  });

  it('handles empty retrieval gracefully', () => {
    const out = synthesize('anything', []);
    expect(out.references).toEqual([]);
    expect(out.confidence).toBe(0);
    expect(out.answer).toMatch(/couldn't find|empty/i);
  });

  it('dedupes near-duplicate lines', () => {
    const dup = {
      id: '3',
      text: 'Built a full-stack MERN application with React, Node.js, Express and MongoDB including REST APIs and authentication.',
      heading: null,
      sourceType: 'experience',
      sourceTitle: 'dup',
      rerankScore: 0.7,
      coverage: 0.7,
    };
    const out = synthesize('mern react express mongodb', [HITS[0], dup]);
    const lines = out.answer.split('\n').slice(1).filter(Boolean);
    const seen = new Set();
    for (const line of lines) {
      const raw = line.replace(/\s*\[\d+\]$/, '').trim().toLowerCase();
      expect(seen.has(raw)).toBe(false);
      seen.add(raw);
    }
  });
});

describe('detectIntent', () => {
  it('classifies skills/projects/experience/general questions', () => {
    expect(detectIntent('what is my tech stack?')).toBe('skills');
    expect(detectIntent('which projects have I built?')).toBe('projects');
    expect(detectIntent('tell me about my internship experience')).toBe('experience');
    expect(detectIntent('hello')).toBe('general');
  });
});

describe('toUnits + scoreUnit', () => {
  it('keeps bullets and splits long prose lines', () => {
    const units = toUnits('- skill one\n- skill two\nThis is a longer prose sentence here that becomes its own unit.');
    expect(units.length).toBe(3);
    expect(units[0]).toBe('- skill one');
  });

  it('scores query-relevant units higher', () => {
    const queryStems = [...new Set(tokenize('react mongodb'))];
    const good = scoreUnit('built apps with react and mongodb', queryStems, ['react', 'mongodb']);
    const bad = scoreUnit('enjoy cooking and photography', queryStems, ['react', 'mongodb']);
    expect(good).toBeGreaterThan(bad);
  });
});
