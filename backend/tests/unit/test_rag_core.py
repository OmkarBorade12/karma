import math

from app.rag.bm25 import Bm25Index
from app.rag.tfidf import TfidfEngine, cosine_sparse
from app.rag.vecmath import normalize_scores, rrf

CORPUS = [
    "built a react dashboard with mongodb Express backend",
    "trained machine learning classifiers with scikit-learn",
    "designed a RAG pipeline with BM25 and TF-IDF retrieval",
]


def test_fits_idf_weights_and_embeds_with_expected_shape():
    v = TfidfEngine()
    v.fit(CORPUS)
    assert v.doc_count == 3
    assert v.vocab_size > 10
    vec = v.embed_query(["react", "dashboard"])
    assert len(vec) > 0
    assert all(w > 0 for w in vec.values())


def test_rare_terms_receive_positive_weight():
    v = TfidfEngine()
    v.fit(CORPUS)
    vec = v.embed_query(["rag", "pipeline"])
    assert len(vec) > 0
    assert all(w > 0 for w in vec.values())


def test_embed_produces_l2_normalized_vectors():
    v = TfidfEngine().fit(CORPUS)
    vec = v.embed_query(["react", "mongodb", "trained"])
    norm = math.sqrt(sum(w * w for w in vec.values()))
    assert abs(norm - 1.0) < 1e-5


def test_cosine_of_identical_vectors_is_1_orthogonal_is_0():
    v = TfidfEngine().fit(["react", "python"])
    a = v.embed_query(["react"])
    b = v.embed_query(["react"])
    c = v.embed_query(["python"])
    assert abs(cosine_sparse(a, b) - 1.0) < 1e-5
    assert abs(cosine_sparse(a, c)) < 1e-5


def test_normalize_scores_min_max():
    assert normalize_scores([0, 5, 10]) == [0, 0.5, 1]


def test_normalize_scores_safe_for_constant_nonzero_arrays():
    assert normalize_scores([3, 3]) == [1, 1]


def test_rrf_fuses_two_ranked_lists_with_position_decay():
    fused = rrf(["a", "b"], ["b", "c"])
    by_id = {f["id"]: f["fused"] for f in fused}
    assert by_id["b"] > by_id["a"]  # in both lists -> top fused score
    assert by_id["a"] > by_id["c"]  # rank-1 list weight beats rank-2


def _build_bm25():
    index = Bm25Index()
    index.add("1", "built a react dashboard with mongodb and express")
    index.add("2", "trained machine learning classifiers with scikit-learn")
    index.add("3", "designed a RAG pipeline with BM25 and TF-IDF retrieval")
    return index.fit()


def test_bm25_ranks_lexically_relevant_docs_first():
    ranked = _build_bm25().score(["react", "dashboard"])
    assert ranked[0][0] == "1"


def test_bm25_returns_empty_for_no_match_queries():
    assert len(_build_bm25().score(["kubernetes", "helm"])) == 0


def test_bm25_term_frequency_saturates():
    one = Bm25Index()
    one.add("x", "mongo")
    one.add("y", "other")
    one.fit()
    s1 = one.score(["mongo"])[0][1]

    six = Bm25Index()
    six.add("x", "mongo mongo mongo mongo mongo mongo")
    six.add("y", "other")
    six.fit()
    s6 = six.score(["mongo"])[0][1]

    assert s6 < s1 * 4  # saturating, not linear growth
    assert s6 > s1
