"""Local extractive answer synthesizer: composes a cited, question-aware answer
purely from retrieved chunks. Deterministic, no external model required.

Port of the original synthesizer, including intent detection, unit scoring,
near-duplicate suppression and intent-first lead selection.
"""

import re

from .tokenizer import is_stopword, tokenize, words_for_display

FALLBACK_ANSWER = (
    "I couldn't find anything in the stored experience that matches this "
    "question yet. Try ingesting more documents or rephrasing."
)

LABEL_PREFIX_RE = re.compile(r"^(title|organization|source|type|kind|outcome|Q)\s*:", re.I)
SOURCE_PAREN_RE = re.compile(r"^\(source[:.)]", re.I)
BULLET_RE = re.compile(r"^[-*\u2022]")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")

_INTENT_SKILLS_TRIGGER = re.compile(r"\b(list|skills|tech stack|know|tools|languages)\b")
_INTENT_SKILLS_SUBJECT = re.compile(r"\bskill|stack|tool|language")
_INTENT_PROJECTS = re.compile(r"\bprojects?\b")
_INTENT_EXPERIENCE = re.compile(r"\bexperience|worked|intern|career|background|journey|story\b")
_INTENT_TIMELINE = re.compile(r"\bhow (long|much)|when\b")

_LEAD_PROJECTS = re.compile(r"\b(built|developed|created|implemented|project)\b", re.I)
_LEAD_EXPERIENCE = re.compile(r"\b(worked|intern|experience|role|at)\b", re.I)
_LEAD_SKILLS = re.compile(r"\b(skills?|proficient|experience with|technologies|stack)\b", re.I)
_SKILLS_LINE = re.compile(r"^skills?\s*:", re.I)


def detect_intent(question: str) -> str:
    q = str(question).lower()
    if _INTENT_SKILLS_TRIGGER.search(q) and _INTENT_SKILLS_SUBJECT.search(q):
        return "skills"
    if _INTENT_PROJECTS.search(q):
        return "projects"
    if _INTENT_EXPERIENCE.search(q):
        return "experience"
    if _INTENT_TIMELINE.search(q):
        return "timeline"
    return "general"


def to_units(text: str) -> list:
    """Split a chunk's text into sentences, keeping list items intact."""
    units = []
    for line in str(text).split("\n"):
        trimmed = line.strip()
        if not trimmed:
            continue
        if BULLET_RE.match(trimmed) or len(trimmed) < 60:
            units.append(trimmed)
            continue
        units.extend(s for s in _SENTENCE_SPLIT_RE.split(trimmed) if s)
    return units


def is_low_info(unit: str) -> bool:
    """QA 'Q:' lines and structural labels never make good answer lines."""
    u = unit.strip()
    return bool(LABEL_PREFIX_RE.match(u) or SOURCE_PAREN_RE.match(u))


def score_unit(unit: str, query_stems, query_words) -> float:
    """Score a unit by overlap with query terms (stems + display words)."""
    if is_low_info(unit):
        return -1.0
    stems = set(tokenize(unit))
    stem_hits = sum(1 for q in query_stems if q in stems)
    stem_score = stem_hits / (len(query_stems) or 1)

    unit_words = words_for_display(unit)
    u_words = set(unit_words)
    word_hits = sum(1 for w in query_words if w in u_words)
    word_score = word_hits / (len(query_words) or 1)

    total_words = len(unit.split()) or 1
    density = sum(1 for w in unit_words if not is_stopword(w)) / total_words
    bonus = 0.05 if re.search(r"[\dx]", unit) else 0.0

    return stem_score * 0.6 + word_score * 0.4 + density * 0.1 + bonus


def _strip_list_marker(unit: str) -> str:
    return re.sub(r"^[-*\u2022]\s*", "", unit)


def synthesize(question, ranked_chunks, max_units: int = 7) -> dict:
    """Compose a cited answer. Returns {answer, references, confidence, metrics}."""
    if not ranked_chunks:
        return {
            "answer": FALLBACK_ANSWER,
            "references": [],
            "confidence": 0,
            "metrics": {"units_used": 0},
        }

    query_stems = list(dict.fromkeys(tokenize(question)))
    query_words = words_for_display(question)
    intent = detect_intent(question)

    candidates = []
    for chunk_idx, chunk in enumerate(ranked_chunks):
        for unit in to_units(chunk["text"]):
            s = score_unit(unit, query_stems, query_words)
            if intent == "skills" and _SKILLS_LINE.match(unit.strip()):
                s += 0.15
            candidates.append(
                {
                    "unit": unit,
                    "chunk_idx": chunk_idx,
                    "score": s + (chunk.get("rerank_score") or chunk.get("fused_score") or 0) * 0.15,
                }
            )
    candidates.sort(key=lambda c: c["score"], reverse=True)

    references = []
    for i, chunk in enumerate(ranked_chunks):
        references.append(
            {
                "n": i + 1,
                "sourceTitle": chunk.get("sourceTitle") or chunk.get("source_title") or "Untitled source",
                "heading": chunk.get("heading"),
                "sourceType": chunk.get("sourceType") or chunk.get("source_type") or "unknown",
                "text": (chunk.get("text") or "")[:400],
            }
        )

    chosen = []
    seen = set()
    for cand in candidates:
        if len(chosen) >= max_units:
            break
        if cand["score"] <= 0.05:
            break
        key = cand["unit"].lower()
        if key in seen:
            continue
        fingerprint = " ".join(key.split()[:8])
        if fingerprint in seen:
            continue
        seen.add(key)
        seen.add(fingerprint)
        chosen.append(cand)

    lead = None
    if intent == "projects":
        lead = next((c for c in chosen if _LEAD_PROJECTS.search(c["unit"])), None)
    elif intent == "experience":
        lead = next((c for c in chosen if _LEAD_EXPERIENCE.search(c["unit"])), None)
    elif intent == "skills":
        lead = next((c for c in chosen if _LEAD_SKILLS.search(c["unit"])), None)

    ordered = [lead, *[c for c in chosen if c is not lead]] if lead else chosen
    body_lines = [
        f"- {_strip_list_marker(c['unit']).strip()} [{c['chunk_idx'] + 1}]" for c in ordered
    ]
    answer = "\n".join(["Here's what your stored experience says:", *body_lines])

    avg_coverage = sum(c.get("coverage", 0) or 0 for c in ranked_chunks) / len(ranked_chunks)
    confidence = max(0.0, min(1.0, avg_coverage * 0.6 + min(len(chosen), 5) / 5 * 0.4))
    metrics = {"units_used": len(ordered), "chunks_used": len(ranked_chunks), "intent": intent}

    return {"answer": answer, "references": references, "confidence": confidence, "metrics": metrics}
