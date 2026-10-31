"""Caching behavior of the hybrid retriever: fitted engines are reused when the
identical corpus object is queried repeatedly, rebuilt when a new corpus is
supplied. Cache state is reset per test via the conftest fixtures."""

import pytest

from app.rag import retriever
from app.rag.tfidf import TfidfEngine

CORPUS = [
    {
        "id": "1",
        "text": "Built a full-stack MERN application with React, Node.js, Express and MongoDB.",
        "heading": "MERN practice",
        "sourceType": "experience",
        "sourceTitle": "MERN",
        "createdAt": None,
    },
    {
        "id": "2",
        "text": "Trained machine learning classifiers in Python with NumPy, pandas and scikit-learn.",
        "heading": "ML foundations",
        "sourceType": "experience",
        "sourceTitle": "ML",
        "createdAt": None,
    },
]


@pytest.fixture
def fit_counter(monkeypatch):
    from app.rag import retriever as retriever_module
    from app.services import rag_index as rag_index_module

    retriever_module.reset_fitted_cache()  # cache-state parity with jest.resetModules
    rag_index_module.reset_corpus_cache()
    calls = {"count": 0}
    original = TfidfEngine.fit

    def counting_fit(self, texts):
        calls["count"] += 1
        return original(self, texts)

    monkeypatch.setattr(TfidfEngine, "fit", counting_fit)
    return calls


def test_fits_vectorizer_once_for_repeated_queries_on_same_corpus(fit_counter):
    retriever.retrieve("react mongodb", CORPUS, top_k=2)
    retriever.retrieve("python scikit-learn", CORPUS, top_k=2)
    retriever.retrieve("rag pipeline", CORPUS, top_k=2)
    assert fit_counter["count"] == 1


def test_refits_when_a_different_corpus_object_is_supplied(fit_counter):
    retriever.retrieve("react mongodb", CORPUS, top_k=2)
    retriever.retrieve("react mongodb", list(CORPUS), top_k=2)  # new object = index change
    assert fit_counter["count"] == 2


def test_returns_full_results_through_cached_engines(fit_counter):
    first = retriever.retrieve("What did I build with React and MongoDB?", CORPUS, top_k=2)
    second = retriever.retrieve("What did I build with React and MongoDB?", CORPUS, top_k=2)
    assert first[0]["id"] == "1"
    assert second[0]["id"] == "1"
