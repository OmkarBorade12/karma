"""Heuristic resume parser: raw resume text → structured profile + experiences.

Deterministic rule-based port of the original parser (no external model).
"""

import re
from datetime import datetime, timezone

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]{2,}")
URL_GITHUB = re.compile(r"(https?://)?(www\.)?github\.com/[\w-]+", re.I)
URL_LINKEDIN = re.compile(r"(https?://)?(www\.)?linkedin\.com/(in|pub)/[\w-]+", re.I)
URL_PORTFOLIO = re.compile(
    r"(https?://)?(www\.)?[\w-]+\.(dev|io|me|site|vercel\.app|netlify\.app)(/[\w-]+)?", re.I
)

SECTION_RE = re.compile(
    r"^(#{0,3}\s*)?(summary|objective|profile|about|skills?|technical skills|tech stack|"
    r"experience|professional experience|work experience|internships?|projects?|"
    r"selected projects|education|certifications?|achievements?|awards?|highlights|"
    r"open[- ]source|hackathons?)\s*[:#-]?\s*$",
    re.I,
)

EXPERIENCE_SECTIONS = {
    "experience", "professional experience", "work experience",
    "internships", "internship", "projects", "selected projects",
}
KIND_BY_SECTION = {
    "internships": "internship",
    "internship": "internship",
    "experience": "job",
    "professional experience": "job",
    "work experience": "job",
    "projects": "project",
    "selected projects": "project",
    "education": "education",
    "certifications": "certification",
    "certification": "certification",
    "open-source": "open-source",
    "open source": "open-source",
    "hackathons": "hackathon",
}
SUMMARY_SECTIONS = {"summary", "objective", "profile", "about"}
SKILLS_SECTIONS = {"skills", "technical skills", "tech stack"}
ACHIEVEMENT_SECTIONS = {"achievements", "awards", "highlights"}

BULLET_RE = re.compile(r"^[-*\u2022\u00B7\d)\].]+\s*\u2022?\s*")
BULLET_CLEAN_RE = re.compile(r"^([-*\u2022\u00B7]|\(?[\d]+[).]|[a-z][).])\s+")
DATE_RANGE_RE = re.compile(
    r"((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4})"
    r"\s*[-\u2013\u2014to]+"
    r"\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4}|present|ongoing|current)",
    re.I,
)
_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_TITLE_DATE_STRIP_RE = re.compile(
    r"\s*[-\u2013\u2014|]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}|\d{4}).*$",
    re.I,
)
_DRAFT_DATE_STRIP_RE = re.compile(r"\s*[-\u2013\u2014|]\s*(\d{4}.*|.*\d{4})$")
_ORG_TAIL_RE = re.compile(r"[-\u2013\u2014|]\s*(.*)$")


def _is_bullet(line: str) -> bool:
    return bool(BULLET_RE.match(line.strip())) and len(line.strip()) > 1


def _clean_bullet(line: str) -> str:
    return BULLET_CLEAN_RE.sub("", line.strip())


def _utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, tzinfo=timezone.utc)


def parse_date_heuristic(text: str):
    """Parse 'Aug 2023 - Present' / '2021 - 2023' style ranges.

    Returns {start, end, ongoing} with aware UTC datetimes, or None.
    """
    m = DATE_RANGE_RE.search(text or "")
    if not m:
        return None

    def to_value(raw: str):
        raw = raw.strip()
        if re.search(r"present|ongoing|current", raw, re.I):
            return "present"
        with_month = re.match(r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)", raw, re.I)
        year_match = re.search(r"\d{4}", raw)
        if not year_match:
            return None
        year = int(year_match.group(0))
        if with_month:
            return _utc(year, _MONTHS[with_month.group(1).lower()], 1)
        return _utc(year, 1, 1)

    start = to_value(m.group(1))
    end_value = to_value(m.group(2))
    ongoing = end_value == "present"
    if start is None:
        return None
    return {"start": start, "end": None if ongoing else end_value, "ongoing": ongoing}


def infer_kind_from_title(title: str, fallback: str) -> str:
    if re.search(r"\bintern\w*\b", title, re.I):
        return "internship"
    if re.search(r"\bproject\b", title, re.I):
        return "project"
    if re.search(r"hackathon", title, re.I):
        return "hackathon"
    if re.search(r"\bcertif", title, re.I):
        return "certification"
    if re.search(r"\b course\b", title, re.I):
        return "education"
    return fallback


def _entry_draft(name, section) -> dict:
    dates = parse_date_heuristic(name) if name else None
    return {
        "title": _DRAFT_DATE_STRIP_RE.sub("", name or "Untitled"),
        "organization": "",
        "kind": KIND_BY_SECTION.get(section, "project"),
        "startDate": dates["start"] if dates else None,
        "endDate": (dates["end"] if dates and not dates["ongoing"] else None) if dates else None,
        "ongoing": dates["ongoing"] if dates else False,
        "description": "",
        "skills": [],
        "highlights": [],
        "outcome": "",
    }


def parse_resume(text) -> dict:
    src = str(text or "")
    lines = src.replace("\r\n", "\n").split("\n")

    profile = {
        "name": "",
        "headline": "",
        "summary": "",
        "email": "",
        "location": "",
        "links": {"github": "", "linkedin": "", "portfolio": ""},
    }
    experiences = []

    for line in lines:
        l = line.strip()
        if not profile["email"] and EMAIL_RE.search(l):
            profile["email"] = EMAIL_RE.search(l).group(0)
        if not profile["links"]["github"]:
            g = URL_GITHUB.search(l)
            if g:
                profile["links"]["github"] = g.group(0)
        if not profile["links"]["linkedin"]:
            li = URL_LINKEDIN.search(l)
            if li:
                profile["links"]["linkedin"] = li.group(0)
        port = URL_PORTFOLIO.search(l)
        if not profile["links"]["portfolio"] and port and not re.search(r"github|linkedin", port.group(0)):
            profile["links"]["portfolio"] = port.group(0)

    # Name = first non-empty, non-link, non-heading short line.
    for idx, line in enumerate(lines):
        l = line.strip()
        if not l:
            continue
        if EMAIL_RE.search(l) or re.search(r"github|linkedin|portfolio", l, re.I) or SECTION_RE.match(l) or _is_bullet(l):
            continue
        if len(l) <= 48 and re.match(r"^[A-Za-z][\w '.-]+$", l):
            profile["name"] = re.sub(r"^#{1,3}\s*", "", l)
            profile["name"] = re.sub(r"\s+resume$", "", profile["name"], flags=re.I).strip()
            for j in range(idx + 1, min(idx + 3, len(lines))):
                h = lines[j].strip()
                if h and not EMAIL_RE.search(h) and not SECTION_RE.match(h) and len(h) <= 90 and not _is_bullet(h):
                    profile["headline"] = h
            break

    current = None
    current_name = None
    current_entry = None
    skill_items = []

    def flush():
        nonlocal current_entry
        if current_entry:
            if not current_entry["title"]:
                current_entry["title"] = current_name or "Untitled"
            current_entry["kind"] = infer_kind_from_title(current_entry["title"], current_entry["kind"])
            if current_entry["highlights"] or current_entry["description"].strip():
                experiences.append(current_entry)
            current_entry = None

    for raw_line in [*lines, ""]:
        l = raw_line.strip()
        section_match = SECTION_RE.match(l)
        if section_match:
            flush()
            current = re.sub(r"^#{0,3}", "", section_match.group(2).lower()).strip()
            if current in SUMMARY_SECTIONS:
                current = "summary"
            current_name = None
            continue
        if not l:
            flush()
            continue
        if current == "summary":
            profile["summary"] = (profile["summary"] + " " if profile["summary"] else "") + l
        elif current in SKILLS_SECTIONS:
            stripped = re.sub(r"^[^:]+\s*:\s?", "", l)
            for item in re.split(r"[,;|\u2022]", stripped):
                item = item.strip()
                if item and len(item) <= 40:
                    skill_items.append(item)
        elif current and current in EXPERIENCE_SECTIONS:
            if _is_bullet(l):
                if current_entry is None:
                    current_entry = _entry_draft(current_name, current)
                current_entry["highlights"].append(_clean_bullet(l))
            elif len(l) <= 100:
                flush()
                current_name = _clean_bullet(l)
                dates = parse_date_heuristic(l)
                current_entry = {
                    "title": _TITLE_DATE_STRIP_RE.sub("", _clean_bullet(l)),
                    "organization": "",
                    "kind": KIND_BY_SECTION.get(current, "project"),
                    "startDate": dates["start"] if dates else None,
                    "endDate": (dates["end"] if dates and not dates["ongoing"] else None) if dates else None,
                    "ongoing": dates["ongoing"] if dates else False,
                    "description": "",
                    "skills": [],
                    "highlights": [],
                    "outcome": "",
                }
                tail = _ORG_TAIL_RE.search(l)
                if tail and not dates:
                    current_entry["organization"] = _clean_bullet(tail.group(1))
            else:
                if current_entry is None:
                    current_entry = _entry_draft(current_name, current)
                current_entry["description"] += (" " if current_entry["description"] else "") + l
        elif current and current in ACHIEVEMENT_SECTIONS:
            if current_entry is None:
                current_entry = _entry_draft("Achievements", current)
                current_entry["kind"] = "personal"
            if _is_bullet(l):
                current_entry["highlights"].append(_clean_bullet(l))
            else:
                current_entry["description"] += (" " if current_entry["description"] else "") + l
    flush()

    if skill_items:
        profile["skills"] = list(dict.fromkeys(skill_items))

    return {"profile": profile, "experiences": experiences}
