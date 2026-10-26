// Smart document chunker: splits text into coherent, embedding-friendly chunks with
// overlap across structural boundaries (headings, paragraphs, lists, sentences).

const MAX_CHARS = parseInt(process.env.KARMA_CHUNK_MAX_CHARS || '700', 10);
const MIN_CHARS = parseInt(process.env.KARMA_CHUNK_MIN_CHARS || '120', 10);
const OVERLAP_SENTS = 1;

function splitSentences(text) {
  const out = [];
  let buf = '';
  const textStr = String(text || '');
  for (let i = 0; i < textStr.length; i++) {
    const ch = textStr[i];
    buf += ch;
    if ('.!?'.includes(ch)) {
      // Guard: single letter followed by '.', common abbreviations, decimals.
      const prev = textStr[i - 1] || '';
      const abbrev = /[a-wyz]$/.test(prev) && (textStr[i + 1] || ' ').match(/[A-Z0-9]/);
      const commonAbbrev = /\b(Mr|Mrs|Dr|Jr|Sr|e\.g|i\.e|vs|approx|etc)\.?$/i.test(buf.trim());
      const decimal = /\d$/.test(prev) && /\d\s/.test(textStr[i + 1] + ' ');
      if (!abbrev && !commonAbbrev && !decimal) {
        out.push(buf.trim());
        buf = '';
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

// Split an oversized sentence at word boundaries into pieces <= maxChars.
function hardSlice(sentence, maxChars) {
  if (sentence.length <= maxChars) return [sentence];
  const parts = [];
  let remaining = sentence.trim();
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf(' ', maxChars);
    if (cut <= 0) cut = maxChars;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter(Boolean);
}

// Detect a markdown-ish / plain heading line.
function isHeading(line) {
  return /^(#{1,6}\s+\S.*|[A-Z][A-Za-z0-9 ,'()&/.+-]{4,60}:)$/.test(line.trim()) ||
    /^(title|project|role|position|company|summary|highlights|selected|experience)\b.{0,60}:$/i.test(line.trim());
}

function structuralBlocks(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let current = { heading: '', lines: [] };
  for (const line of lines) {
    if (isHeading(line)) {
      if (current.lines.join('').trim()) blocks.push(current);
      current = { heading: line.trim().replace(/^#{1,6}\s+/, ''), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) blocks.push(current);
  const merged = blocks.map((b) => ({
    heading: b.heading,
    text: b.lines.join('\n').trim(),
  }));
  return merged.length ? merged : [{ heading: '', text: text.trim() }].filter((b) => b.text);
}

/**
 * Chunk a document into overlapping, self-contained passages.
 * Keeps line/list structure intact; slides a sentence-window when single blocks
 * are larger than MAX_CHARS. Returns [{ text, heading, index }]. Never empty for
 * non-empty input; empty array for non-empty-free... i.e. [] for blank input.
 */
function chunkText(text, { maxChars = MAX_CHARS, minChars = MIN_CHARS } = {}) {
  const blocks = structuralBlocks(text);
  const chunks = [];

  for (const block of blocks) {
    if (block.text.length <= maxChars) {
      if (block.text.length > 0) {
        chunks.push({ text: block.text, heading: block.heading });
      }
      continue;
    }
    // Large block: window over sentence/list units, committing BEFORE the
    // window would exceed maxChars; oversized units are hard-split at word
    // boundaries so every committed chunk stays within bounds.
    const units = [];
    for (const line of block.text.split('\n')) {
      if (!line.trim()) continue;
      if (line.length > maxChars) {
        units.push(...splitSentences(line).flatMap((s) => hardSlice(s, maxChars)));
      } else {
        units.push(line.trim());
      }
    }

    const committed = [];
    let window = [];
    const windowLen = () => window.join('\n').length;
    for (const unit of units) {
      if (window.length && windowLen() + 1 + unit.length > maxChars) {
        committed.push(window.join('\n'));
        const overlap = window[window.length - 1];
        // keep the overlap only when it is small enough to combine with the next unit
        window = overlap.length + 1 <= maxChars / 2 ? [overlap] : [];
      }
      window.push(unit);
    }

    // Preserve the final remainder: merge it into the last committed chunk when
    // it fits within maxChars, otherwise keep it as its own (possibly short)
    // chunk. Dropping it would silently lose document content.
    const remainder = window.join('\n').trim();
    if (remainder) {
      const last = committed[committed.length - 1];
      if (last && last.length + 1 + remainder.length <= maxChars) {
        committed[committed.length - 1] = `${last}\n${remainder}`;
      } else {
        committed.push(remainder);
      }
    }
    for (const text of committed) {
      chunks.push({ text, heading: block.heading });
    }
  }

  return chunks
    .filter((c) => c.text.trim().length > 0)
    .map((c, index) => ({ ...c, index, text: c.text.trim() }));
}

module.exports = { chunkText, splitSentences, isHeading };
