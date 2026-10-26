const { chunkText, splitSentences, isHeading } = require('../../src/rag/chunker');

const LONG_TEXT = [
  '# Machine Learning',
  'Regression is about predicting continuous values. Classification assigns categories. Both need careful evaluation metrics such as precision, recall and F1.',
  '',
  '## Deep Learning',
  'Neural networks stack nonlinear layers. Training uses backpropagation with gradient descent. Overfitting is controlled with regularization and validation sets.',
  '',
  '## Deployment',
  'Models are served behind REST APIs. Monitoring catches drift.',
].join('\n');

describe('chunker', () => {
  describe('splitSentences', () => {
    it('splits on sentence boundaries', () => {
      expect(splitSentences('Ml is fun. RAG is hard! Right? No.')).toEqual([
        'Ml is fun.',
        'RAG is hard!',
        'Right?',
        'No.',
      ]);
    });

    it('preserves decimals', () => {
      const s = splitSentences('Accuracy reached 0.95. Good model.');
      expect(s.length).toBe(2);
      expect(s[0]).toBe('Accuracy reached 0.95.');
      expect(s[1]).toBe('Good model.');
    });

    it('keeps abbreviation-interrupted sentences together', () => {
      const s = splitSentences('Dr. Vyas said ML works. Then left.');
      expect(s.length).toBe(2);
      expect(s[0]).toContain('Dr. Vyas');
    });
  });

  describe('isHeading', () => {
    it('detects markdown and colon headings', () => {
      expect(isHeading('## Projects')).toBe(true);
      expect(isHeading('SKILLS:')).toBe(true);
      expect(isHeading('just a normal sentence')).toBe(false);
    });
  });

  describe('chunkText', () => {
    it('produces chunks with headings preserved', () => {
      const chunks = chunkText(LONG_TEXT);
      expect(chunks.length).toBeGreaterThan(0);
      const headings = new Set(chunks.map((c) => c.heading));
      expect(headings.has('Machine Learning')).toBe(true);
      expect(headings.has('Deep Learning')).toBe(true);
      expect(headings.has('Deployment')).toBe(true);
    });

    it('indexes chunks sequentially', () => {
      const chunks = chunkText(LONG_TEXT);
      expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    });

    it('respects max chunk size with overlap', () => {
      const paragraph = 'A '.repeat(800) + 'END.';
      const chunks = chunkText(paragraph, { maxChars: 200, minChars: 50 });
      expect(chunks.every((c) => c.text.length <= 220)).toBe(true);
      expect(chunks.length).toBeGreaterThan(3);
    });

    it('returns [] for blank input and non-empty for single sentence', () => {
      expect(chunkText('   \n  ')).toEqual([]);
      expect(chunkText('One single line of experience.').length).toBe(1);
    });

    it('never merges unrelated sections when bounded', () => {
      const chunks = chunkText(LONG_TEXT);
      for (const c of chunks) {
        if (c.heading === 'Deployment') expect(c.text).toContain('REST APIs');
      }
    });
  });
});
