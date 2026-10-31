"""Okapi BM25 (k1=1.5, b=0.75, non-negative idf) over the local chunk corpus."""

import math
from collections import Counter, defaultdict

from .tokenizer import tokenize


class Bm25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.docs = []  # [{id, tf, len}]
        self.avgdl = 0.0
        self.df = {}

    def add(self, doc_id, text) -> "Bm25Index":
        tokens = tokenize(text)
        tf = Counter(tokens)
        self.docs.append({"id": doc_id, "tf": tf, "len": len(tokens) or 1})
        return self

    def fit(self) -> "Bm25Index":
        self.avgdl = sum(d["len"] for d in self.docs) / (len(self.docs) or 1)
        self.df = defaultdict(int)
        for d in self.docs:
            for term in d["tf"]:
                self.df[term] += 1
        return self

    def _idf_raw(self, term) -> float:
        n = len(self.docs) or 1
        df = self.df.get(term, 0)
        return math.log((n - df + 0.5) / (df + 0.5) + 1)

    def score(self, query_tokens) -> list:
        """Return [(id, score)] sorted desc; only positive scores included."""
        results = {}
        for d in self.docs:
            s = 0.0
            for term in set(query_tokens):
                f = d["tf"].get(term, 0)
                if not f:
                    continue
                idf = self._idf_raw(term)
                denom = f + self.k1 * (1 - self.b + self.b * (d["len"] / self.avgdl))
                s += idf * ((f * (self.k1 + 1)) / denom)
            if s > 0:
                results[d["id"]] = s
        return sorted(results.items(), key=lambda kv: kv[1], reverse=True)
