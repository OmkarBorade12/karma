// Heuristic resume parser: converts raw resume text into a structured profile
// + experience entries. Deterministic rule-based (no external model needed).

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
const URL_GITHUB = /(https?:\/\/)?(www\.)?github\.com\/[\w-]+/i;
const URL_LINKEDIN = /(https?:\/\/)?(www\.)?linkedin\.com\/(in|pub)\/[\w-]+/i;

const SECTION_RE = /^(#{0,3}\s*)?(summary|objective|profile|about|skills?|technical skills|tech stack|experience|professional experience|work experience|internships?|projects?|selected projects|education|certifications?|achievements?|awards?|highlights|open[- ]source|hackathons?)\s*[:#-]?\s*$/i;

const EXPERIENCE_SECTIONS = new Set(['experience', 'professional experience', 'work experience', 'internships', 'internship', 'projects', 'selected projects']);
const KIND_BY_SECTION = {
  internships: 'internship',
  internship: 'internship',
  experience: 'job',
  'professional experience': 'job',
  'work experience': 'job',
  projects: 'project',
  'selected projects': 'project',
  education: 'education',
  certifications: 'certification',
  certification: 'certification',
  'open-source': 'open-source',
  'open source': 'open-source',
  hackathons: 'hackathon',
};

function isBullet(line) {
  return /^[-*\u2022\u00B7\d)\].]+\s*[\u2022]?\s*/.test(line.trim()) && line.trim().length > 1;
}

function cleanBullet(line) {
  return line.trim().replace(/^([-*\u2022\u00B7]|\(?[\d]+[).]|[a-z][).])\s+/, '');
}

function parseDateHeuristic(text) {
  // Matches "Aug 2023", "2021 - 2023", "Jan 2022 - Present"
  const m = text.match(
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4})\s*[-\u2013\u2014to]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4}|present|ongoing|current)/i
  );
  if (!m) return null;
  const toISO = (raw) => {
    raw = raw.trim();
    if (/present|ongoing|current/i.test(raw)) return 'present';
    const withMonth = raw.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (withMonth) {
      const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      return new Date(Date.UTC(raw.match(/\d{4}/)[0], months[withMonth[1].toLowerCase()], 1));
    }
    return new Date(Date.UTC(raw, 0, 1));
  };
  const start = toISO(m[1]);
  const endRaw = toISO(m[2]);
  const end = endRaw === 'present' ? null : endRaw;
  return { start, end, ongoing: endRaw === 'present' };
}

// Infer entry kind from its title when the section alone is ambiguous
// ('Software Engineer Intern — ...' is an internship, not a generic job).
function inferKindFromTitle(title, fallback) {
  if (/\bintern\w*\b/i.test(title)) return 'internship';
  if (/\bproject\b/i.test(title)) return 'project';
  if (/hackathon/i.test(title)) return 'hackathon';
  if (/\bcertif/i.test(title)) return 'certification';
  if (/\b course\b/i.test(title)) return 'education';
  return fallback;
}

/**
 * Parse raw resume text into { profile, experiences }.
 */
function parseResume(text) {
  const src = String(text || '');
  const lines = src.replace(/\r\n/g, '\n').split('\n');

  const profile = {
    name: '',
    headline: '',
    summary: '',
    email: '',
    location: '',
    links: { github: '', linkedin: '', portfolio: '' },
  };
  const experiences = [];

  for (const line of lines) {
    const l = line.trim();
    if (!profile.email && EMAIL_RE.test(l)) profile.email = (l.match(EMAIL_RE) || [])[0];
    if (!profile.links.github) {
      const g = l.match(URL_GITHUB);
      if (g) profile.links.github = g[0];
    }
    if (!profile.links.linkedin) {
      const li = l.match(URL_LINKEDIN);
      if (li) profile.links.linkedin = li[0];
    }
    const port = l.match(/(https?:\/\/)?(www\.)?[\w-]+\.(dev|io|me|site|vercel\.app|netlify\.app)(\/[\w-]+)?/i);
    if (!profile.links.portfolio && port && !/github|linkedin/.test(port[0])) {
      profile.links.portfolio = port[0];
    }
  }

  // Name = first non-empty, non-link, non-heading short line.
  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;
    if (EMAIL_RE.test(l) || /(github|linkedin|portfolio)/i.test(l) || SECTION_RE.test(l) || isBullet(l)) continue;
    if (l.length <= 48 && /^[A-Za-z][\w '.-]+$/.test(l)) {
      profile.name = l.replace(/^#{1,3}\s*/, '').replace(/\s+resume$/i, '').trim();
      // headline often directly below
      const idx = lines.indexOf(line);
      for (let j = idx + 1; j < Math.min(idx + 3, lines.length); j++) {
        const h = lines[j].trim();
        if (h && !EMAIL_RE.test(h) && !SECTION_RE.test(h) && h.length <= 90 && !isBullet(h)) {
          profile.headline = h;
        }
      }
      break;
    }
  }

  // Walk sections
  let current = null;
  let currentName = null;
  let currentEntry = null;
  const skillItems = [];
  const flush = () => {
    if (currentEntry) {
      if (!currentEntry.title) currentEntry.title = currentName || 'Untitled';
      currentEntry.kind = inferKindFromTitle(currentEntry.title, currentEntry.kind);
      if (currentEntry.highlights.length || currentEntry.description.trim()) {
        experiences.push(currentEntry);
      }
      currentEntry = null;
    }
  };

  for (const rawLine of [...lines, '']) {
    const l = rawLine.trim();
    const sectionMatch = l.match(SECTION_RE);
    if (sectionMatch) {
      flush();
      current = sectionMatch[2].toLowerCase().replace(/^#{0,3}/, '').trim();
      if (current === 'summary' || current === 'objective' || current === 'profile' || current === 'about') {
        current = 'summary';
      }
      currentName = null;
      continue;
    }
    if (!l) {
      flush();
      continue;
    }
    if (current === 'summary') {
      profile.summary = (profile.summary ? profile.summary + ' ' : '') + l;
    } else if (current === 'skills' || current === 'technical skills' || current === 'tech stack') {
      const items = l
        .replace(/^[^:]+\s*:\s?/, '')
        .split(/[,;|\u2022]/)
        .map((s) => s.trim())
        .filter((s) => s && s.length <= 40);
      skillItems.push(...items);
    } else if (current && EXPERIENCE_SECTIONS.has(current)) {
      if (isBullet(l)) {
        if (!currentEntry) currentEntry = entryDraft(currentName, current);
        currentEntry.highlights.push(cleanBullet(l));
      } else if (l.length <= 100) {
        // new entry heading line
        flush();
        currentName = cleanBullet(l);
        const dates = parseDateHeuristic(l);
        currentEntry = {
          title: cleanBullet(l).replace(
            /\s*[-\u2013\u2014|]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4}).*$/i,
            ''
          ),
          organization: '',
          kind: KIND_BY_SECTION[current] || 'project',
          startDate: dates ? dates.start : null,
          endDate: dates && !dates.ongoing ? dates.end : null,
          ongoing: dates ? dates.ongoing : false,
          description: '',
          skills: [],
          highlights: [],
          outcome: '',
        };
        const tail = l.match(/[-\u2013\u2014|]\s*(.*)$/);
        if (tail && !dates) currentEntry.organization = cleanBullet(tail[1]);
      } else {
        if (!currentEntry) currentEntry = entryDraft(currentName, current);
        currentEntry.description += (currentEntry.description ? ' ' : '') + l;
      }
    } else if (current && (current === 'achievements' || current === 'awards' || current === 'highlights')) {
      if (!currentEntry) currentEntry = { ...entryDraft('Achievements', current), kind: 'personal', highlights: [] };
      if (isBullet(l)) currentEntry.highlights.push(cleanBullet(l));
      else currentEntry.description += (currentEntry.description ? ' ' : '') + l;
    }
  }
  flush();

  if (skillItems.length) profile.skills = [...new Set(skillItems)];

  return { profile, experiences };
}

function entryDraft(name, section) {
  const dates = name ? parseDateHeuristic(name) : null;
  return {
    title: (name || 'Untitled').replace(/\s*[-\u2013\u2014|]\s*(\d{4}.*|.*\d{4})$/, ''),
    organization: '',
    kind: KIND_BY_SECTION[section] || 'project',
    startDate: dates ? dates.start : null,
    endDate: dates && !dates.ongoing ? dates.end : null,
    ongoing: dates ? dates.ongoing : false,
    description: '',
    skills: [],
    highlights: [],
    outcome: '',
  };
}

module.exports = { parseResume, parseDateHeuristic };
