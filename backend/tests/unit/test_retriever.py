from datetime import datetime, timezone

from app.rag.retriever import rerank, retrieve

CORPUS = [
    {
        "id": "1",
        "text": "Built a full-stack MERN application with React, Node.js, Express and MongoDB including REST APIs and authentication.",
        "heading": "Full-Stack MERN development practice",
        "sourceType": "experience",
        "sourceTitle": "MERN practice",
        "createdAt": datetime(2025, 1, 1, tzinfo=timezone.utc),
    },
    {
        "id": "2",
        "text": "Trained machine learning classifiers in Python with NumPy, pandas and scikit-learn using cross-validation.",
        "heading": "Machine Learning Foundations",
        "sourceType": "experience",
        "sourceTitle": "ML foundations",
        "createdAt": datetime(2025, 2, 1, tzinfo=timezone.utc),
    },
    {
        "id": "3",
        "text": "Implemented a retrieval-augmented generation pipeline: BM25 + TF-IDF cosine retrieval with reciprocal rank fusion and cited answer synthesis.",
        "heading": "RAG and intelligent-systems",
        "sourceType": "experience",
        "sourceTitle": "RAG study",
        "createdAt": datetime(2025, 3, 1, tzinfo=timezone.utc),
    },
    {
        "id": "4",
        "text": "I like coffee in the mornings before coding sessions.",
        "heading": "",
        "sourceType": "note",
        "sourceTitle": "Daily notes",
        "createdAt": datetime(2025, 4, 1, tzinfo=timezone.utc),
    },
]


def test_ranks_most_relevant_chunk_first():
    hits = retrieve("What did I build with React and MongoDB?", CORPUS, top_k=3)
    assert len(hits) > 0
    assert hits[0]["id"] == "1"


def test_finds_ml_experience_for_skill_questions():
    hits = retrieve("What experience do I have with scikit-learn?", CORPUS, top_k=2)
    assert hits[0]["id"] == "2"


def test_excludes_irrelevant_personal_notes_from_technical_queries():
    hits = retrieve("How does my RAG pipeline retrieve documents?", CORPUS, top_k=3)
    assert all(h["id"] != "4" for h in hits)


def test_returns_empty_for_empty_corpus_or_question():
    assert retrieve("anything", [], top_k=3) == []
    assert retrieve("   ", CORPUS, top_k=3) == []


def test_attaches_score_breakdown_fields():
    hits = retrieve("react dashboard", CORPUS, top_k=1)
    assert "fused_score" in hits[0]
    assert "bm25_score" in hits[0]
    assert "cosine_score" in hits[0]
    assert "rerank_score" in hits[0]
    assert "coverage" in hits[0]


def test_respects_top_k_bounds():
    hits = retrieve("experience with React, Python or RAG", CORPUS, top_k=2)
    assert len(hits) == 2


def test_rerank_boosts_chunks_covering_more_query_terms():
    q = ["react", "applications"]
    a = {"id": "a", "text": "React applications built with care.", "fused_score": 0.01,
         "sourceType": "note", "createdAt": datetime.now(timezone.utc)}
    b = {"id": "b", "text": "Unrelated text completely.", "fused_score": 0.01,
         "sourceType": "note", "createdAt": datetime.now(timezone.utc)}
    ranked = rerank([b, a], q)
    assert ranked[0]["id"] == "a"


def test_rerank_applies_source_type_weights():
    q = ["react", "applications"]
    same_text = "documents about react applications and node"
    exp = {"id": "e", "text": same_text, "heading": None, "fused_score": 0.5,
           "sourceType": "experience", "createdAt": datetime.now(timezone.utc)}
    note = {"id": "n", "text": same_text, "heading": None, "fused_score": 0.5,
            "sourceType": "note", "createdAt": datetime.now(timezone.utc)}
    ranked = rerank([note, exp], q)
    assert ranked[0]["id"] == "e"
