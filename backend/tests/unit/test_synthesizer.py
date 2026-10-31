from app.rag.synthesizer import detect_intent, score_unit, synthesize, to_units
from app.rag.tokenizer import tokenize

HITS = [
    {
        "id": "1",
        "text": "Built a full-stack MERN application with React, Node.js, Express and MongoDB including REST APIs and authentication.\n- skills: React, Node.js, Express, MongoDB",
        "heading": "Full-Stack MERN development practice",
        "sourceType": "experience",
        "sourceTitle": "Full-Stack MERN development practice",
        "rerank_score": 0.8,
        "coverage": 0.8,
    },
    {
        "id": "2",
        "text": "Implemented a summary retrieval pipeline for grounded answers with citations.",
        "heading": "RAG study",
        "sourceType": "experience",
        "sourceTitle": "RAG and intelligent-systems study",
        "rerank_score": 0.5,
        "coverage": 0.3,
    },
]


def test_produces_cited_answer_with_references():
    out = synthesize("What projects did I build with React and MongoDB?", HITS)
    assert "[1]" in out["answer"]
    assert len(out["references"]) == 2
    assert out["references"][0]["n"] == 1
    assert out["references"][0]["sourceTitle"] == HITS[0]["sourceTitle"]
    assert out["references"][0]["sourceType"] == "experience"
    assert out["confidence"] > 0
    assert out["metrics"]["units_used"] > 0


def test_puts_intent_selected_unit_early_in_the_answer():
    out = synthesize("What technical skills do I have?", HITS, max_units=4)
    assert "[1]" in out["answer"].split("\n")[1]


def test_handles_empty_retrieval_gracefully():
    out = synthesize("anything", [])
    assert out["references"] == []
    assert out["confidence"] == 0
    assert "couldn't find" in out["answer"] or "empty" in out["answer"].lower()


def test_dedupes_near_duplicate_lines():
    import re

    dup = {
        "id": "3",
        "text": "Built a full-stack MERN application with React, Node.js, Express and MongoDB including REST APIs and authentication.",
        "heading": None,
        "sourceType": "experience",
        "sourceTitle": "dup",
        "rerank_score": 0.7,
        "coverage": 0.7,
    }
    out = synthesize("mern react express mongodb", [HITS[0], dup])
    lines = [l for l in out["answer"].split("\n")[1:] if l]
    seen = set()
    for line in lines:
        raw = re.sub(r"\[\d+\]$", "", line.strip()).strip().lower()
        assert raw not in seen
        seen.add(raw)


def test_detect_intent_classifies_question_types():
    assert detect_intent("what is my tech stack?") == "skills"
    assert detect_intent("which projects have I built?") == "projects"
    assert detect_intent("tell me about my internship experience") == "experience"
    assert detect_intent("hello") == "general"


def test_to_units_keeps_bullets_and_splits_prose():
    units = to_units("- skill one\n- skill two\nThis is a longer prose sentence here that becomes its own unit.")
    assert len(units) == 3
    assert units[0] == "- skill one"


def test_score_unit_ranks_query_relevant_units_higher():
    query_stems = list(dict.fromkeys(tokenize("react mongodb")))
    good = score_unit("built apps with react and mongodb", query_stems, ["react", "mongodb"])
    bad = score_unit("enjoy cooking and photography", query_stems, ["react", "mongodb"])
    assert good > bad
