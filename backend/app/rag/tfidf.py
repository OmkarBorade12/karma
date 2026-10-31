"""TF-IDF vectorization via scikit-learn plus hand-curated query expansion.

The sklearn vectorizer is configured to reproduce the original smooth-idf,
sublinear-tf, L2-normalized formulation exactly:
    idf(t) = ln((1 + N) / (1 + df)) + 1,  weight = (1 + ln(tf)) * idf, L2 norm.
"""

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize as _l2_normalize
import numpy as np

from .tokenizer import tokenize

SYNONYMS = {
    "react": ["hooks", "component", "frontend"],
    "mongodb": ["database", "nosql", "collection"],
    "node": ["backend", "server", "express"],
    "python": ["script", "ml", "numpy", "pandas"],
    "machine": ["model", "training", "features"],
    "internship": ["intern", "experience", "worked"],
    "project": ["built", "developed", "implemented"],
    "data": ["dataset", "pipeline", "analysis"],
    "api": ["rest", "endpoint", "http"],
    "leader": ["led", "team", "managed", "coordinated"],
    "hackathon": ["competition", "prize", "winner"],
}


def expand_query(tokens) -> list:
    """Append nearby conceptual synonyms (vector side only, never BM25)."""
    out = list(tokens)
    for t in tokens:
        for syn in SYNONYMS.get(t, []):
            out.extend(syn.split(" "))
    return out


class TfidfEngine:
    """Wraps sklearn's TfidfVectorizer over the custom KARMA tokenizer.

    Exposes the same operations the retriever and the Qdrant vector store
    need: fit over a corpus, dense-sparse embedding of documents, and sparse
    transform of (expanded) queries.
    """

    def __init__(self):
        self._vectorizer = TfidfVectorizer(
            tokenizer=tokenize,
            preprocessor=lambda t: t,
            lowercase=False,
            token_pattern=None,
            sublinear_tf=True,
            smooth_idf=True,
            norm="l2",
        )
        self.doc_count = 0
        self.vocab_size = 0

    def fit(self, texts) -> "TfidfEngine":
        texts = list(texts)
        self._vectorizer.fit(texts)
        self.doc_count = len(texts)
        self.vocab_size = len(self._vectorizer.vocabulary_)
        return self

    def embed_matrix(self, texts):
        """Sparse scipy matrix (n_docs x vocab), L2-normalized rows."""
        return self._vectorizer.transform(list(texts))

    def embed_query(self, tokens) -> dict:
        """Sparse {column_index: weight} for a token list (query side)."""
        text = " ".join(tokens)
        matrix = self._vectorizer.transform([text])
        coo = matrix.tocoo()
        return {int(col): float(w) for col, w in zip(coo.col, coo.data) if w > 0}

    def embed_document(self, text) -> dict:
        """Sparse {column_index: weight} for a corpus document."""
        matrix = self._vectorizer.transform([text])
        coo = matrix.tocoo()
        return {int(col): float(w) for col, w in zip(coo.col, coo.data) if w > 0}

    def vector_dim(self) -> int:
        return max(self.vocab_size, 1)


def cosine_sparse(a: dict, b: dict) -> float:
    """Cosine similarity between two sparse {idx: weight} dicts."""
    if not a or not b:
        return 0.0
    dot = 0.0
    for k, v in a.items():
        if k in b:
            dot += v * b[k]
    if dot == 0.0:
        return 0.0
    na = np.sqrt(sum(v * v for v in a.values()))
    nb = np.sqrt(sum(v * v for v in b.values()))
    if na == 0 or nb == 0:
        return 0.0
    return float(dot / (na * nb))
