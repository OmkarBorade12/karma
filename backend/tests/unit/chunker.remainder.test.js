// No-text-loss guarantees for the chunker: the final remainder must never be
// silently dropped and no chunk may exceed maxChars.

const { chunkText } = require('../../src/rag/chunker');

function line(char, length, sentinel) {
  return char.repeat(length) + sentinel;
}

describe('chunker remainder preservation', () => {
  it('keeps a short tail remainder as its own chunk instead of dropping it', () => {
    // 3 lines of 60 chars with maxChars 100 / minChars 90: the last windowed
    // remainder (60 chars) used to be discarded silently.
    const text = [line('a', 57, '.AA'), line('b', 57, '.BB'), line('c', 57, '.CC')].join('\n');
    const chunks = chunkText(text, { maxChars: 100, minChars: 90 });
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('.AA');
    expect(all).toContain('.BB');
    expect(all).toContain('.CC'); // previously dropped
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
  });

  it('merges a tail remainder into the last chunk when it still fits', () => {
    const text = [line('a', 40, '.AA'), line('b', 40, '.BB'), line('c', 30, '.CC')].join('\n');
    const chunks = chunkText(text, { maxChars: 120, minChars: 45 });
    const last = chunks[chunks.length - 1];
    expect(last.text).toContain('.CC');
    expect(last.text).toContain('.BB'); // merged remainder keeps the tail together
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(120);
  });

  it('loses no sentinel across a long multi-section document', () => {
    const text = [
      '# Section One',
      line('x', 200, ' ALPHA_START '),
      '## Section Two',
      line('y', 300, ' MIDWAY_GUARD '),
      '## Deployment',
      line('z', 640, ' OMEGA_END.'),
    ].join('\n');
    const chunks = chunkText(text, { maxChars: 700, minChars: 120 });
    const all = chunks.map((c) => c.text).join('\n');
    expect(all).toContain('ALPHA_START');
    expect(all).toContain('MIDWAY_GUARD');
    expect(all).toContain('OMEGA_END');
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(700);
  });
});
