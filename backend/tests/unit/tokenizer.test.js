const { tokenize, stem, normalize, wordsForDisplay, isStopword } = require('../../src/rag/tokenizer');

describe('tokenizer', () => {
  describe('tokenize', () => {
    it('lowercases, removes punctuation and stopwords', () => {
      expect(tokenize('The Quick, and Brown FOX!')).toEqual(['quick', 'brown', 'fox']);
    });

    it('splits dotted identifiers into words but keeps known tech names', () => {
      expect(tokenize('react.js was used with node.js')).toEqual(['react.js', 'used', 'node.js']);
    });

    it('stems common suffixes', () => {
      expect(tokenize('running studies cactuses')[0]).toBe('run');
      expect(stem('running')).toBe('run');
      expect(stem('studies')).toBe('study');
      expect(stem('building')).toBe('build');
      expect(stem('raining')).toBe('rain');
    });

    it('returns empty array for empty or stopword-only input', () => {
      expect(tokenize('')).toEqual([]);
      expect(tokenize('the a of and')).toEqual([]);
    });

    it('handles null input', () => {
      expect(tokenize(null)).toEqual([]);
      expect(tokenize(undefined)).toEqual([]);
    });

    it('splits slash tokens, dropping single-char fragments', () => {
      expect(tokenize('python/r')).toEqual(['python']);
      expect(tokenize('node/backend')[1]).toBe('backend');
    });

    it('normalize strips unicode punctuation variants', () => {
      expect(normalize('HELLO – World!')).toBe('hello - world ');
    });
  });

  describe('wordsForDisplay', () => {
    it('returns unstemmed meaningful words', () => {
      const words = wordsForDisplay('I trained models with TensorFlow');
      expect(words).toContain('trained');
      expect(words).toContain('tensorflow');
      expect(words).not.toContain('with');
    });
  });

  describe('isStopword', () => {
    it('classifies stopwords correctly', () => {
      expect(isStopword('the')).toBe(true);
      expect(isStopword('tensorflow')).toBe(false);
    });
  });
});
