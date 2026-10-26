const { parseResume, parseDateHeuristic } = require('../../src/services/profileParser');

const SAMPLE_RESUME = [
  'Jane Doe',
  'Full-Stack Developer | RAG enthusiast',
  'jane.doe@example.com | github.com/janedoe | linkedin.com/in/janedoe | janedoe.dev',
  '',
  'SUMMARY',
  'I build MERN apps and RAG pipelines. I love ML.',
  '',
  'SKILLS',
  'JavaScript, Python, React, Node.js, MongoDB, TF-IDF, unit testing',
  '',
  'EXPERIENCE',
  'Software Engineer Intern — TechCorp (Jun 2023 - Dec 2023)',
  '- Built 4 REST endpoints serving the reporting dashboard.',
  '- Reduced query time by 30% by indexing MongoDB collections.',
  'AI Ninja Project (2022 - 2023)',
  '- Implemented TF-IDF retrieval over study notes.',
  '',
  'EDUCATION',
  'B.Sc. Computer Science, ABC University (2020 - 2024)',
].join('\n');

describe('resume parser', () => {
  const parsed = parseResume(SAMPLE_RESUME);

  it('extracts contact and links', () => {
    expect(parsed.profile.email).toBe('jane.doe@example.com');
    expect(parsed.profile.links.github).toContain('github.com/janedoe');
    expect(parsed.profile.links.linkedin).toContain('linkedin.com/in/janedoe');
  });

  it('extracts name and headline from the top lines', () => {
    expect(parsed.profile.name).toBe('Jane Doe');
    expect(parsed.profile.headline).toContain('Full-Stack Developer');
  });

  it('captures the summary section', () => {
    expect(parsed.profile.summary).toContain('MERN apps and RAG pipelines');
  });

  it('parses skills line into a list', () => {
    expect(parsed.profile.skills).toEqual(
      expect.arrayContaining(['JavaScript', 'Python', 'React', 'Node.js', 'MongoDB', 'unit testing'])
    );
  });

  it('creates experience entries with dates, bullets and kinds', () => {
    expect(parsed.experiences.length).toBeGreaterThanOrEqual(2);

    const intern = parsed.experiences.find((e) => /Software Engineer Intern/i.test(e.title));
    expect(intern).toBeTruthy();
    expect(intern.kind).toBe('internship');
    expect(intern.endDate && intern.endDate.getUTCFullYear()).toBe(2023);
    expect(intern.startDate && intern.startDate.getUTCMonth()).toBe(5); // June
    expect(intern.highlights).toHaveLength(2);
    expect(intern.highlights[0]).not.toMatch(/^[-*\u2022]/);

    const project = parsed.experiences.find((e) => /AI Ninja/i.test(e.title));
    expect(project).toBeTruthy();
    expect(project.kind).toBe('project');
    expect(project.ongoing).toBe(false);
  });

  it('returns empty experiences when nothing matches', () => {
    const out = parseResume('Just some random text with no structure.');
    expect(Array.isArray(out.experiences)).toBe(true);
    expect(out.profile.email).toBe('');
  });

  it('handles null-ish input', () => {
    const out = parseResume(null);
    expect(out.profile.name).toBe('');
    expect(out.experiences).toEqual([]);
  });
});

describe('parseDateHeuristic', () => {
  it('parses month-year ranges with Present', () => {
    const d = parseDateHeuristic('Software Intern (Aug 2024 - Present)');
    expect(d.ongoing).toBe(true);
    expect(d.end).toBe(null);
    expect(d.start.getUTCMonth()).toBe(7);
  });

  it('parses bare year ranges', () => {
    const d = parseDateHeuristic('GroCoder 2021 - 2023');
    expect(d.start.getUTCFullYear()).toBe(2021);
    expect(d.end.getUTCFullYear()).toBe(2023);
    expect(d.ongoing).toBe(false);
  });

  it('returns null when no dates present', () => {
    expect(parseDateHeuristic('no dates here')).toBe(null);
  });
});
