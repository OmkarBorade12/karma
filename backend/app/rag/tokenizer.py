"""Text normalization, tokenization and stemming used across the RAG engine.

Faithful Python port of the original from-scratch tokenizer (deterministic,
dependency-free, Porter-flavoured stemmer included).
"""

import re

STOPWORDS = frozenset(
    [
        "a", "an", "the", "and", "or", "but", "if", "then", "than", "so", "because",
        "of", "at", "by", "for", "with", "about", "to", "from", "in", "into", "on",
        "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
        "have", "has", "had", "i", "me", "my", "we", "our", "you", "your", "he",
        "she", "his", "her", "it", "its", "they", "them", "their", "this", "that",
        "these", "those", "as", "there", "here", "what", "which", "who", "whom",
        "will", "would", "can", "could", "should", "may", "might", "just", "also",
    ]
)

STOPWORD_PREFIXES = re.compile(r"^(?:pre|post|trans|de|un|in|re|con)$")

_CURLY_SINGLE = str.maketrans({"’": "'", "‘": "'", "‛": "'", "“": '"', "”": '"'})
_DASHES = str.maketrans({c: "-" for c in "‐‑‒–—−"})

_KEEP_RE = re.compile(r"^[#/][\w/#.+]+$", re.A)
_WORD_RE = re.compile(r"^[a-z0-9]+[\w-]*$", re.A)
_SPLIT_RE = re.compile(r"[./]")
_STRIP_DASHES_RE = re.compile(r"^-+|-+$")


def _consolidate_base(base: str) -> str:
    """Undo geminated consonants from -ing/-ed stripping ('running' -> 'run')."""
    last3 = base[-3:]
    if len(last3) == 3 and last3[1] == last3[2] and last3[2] not in "aeiouyw":
        return base[:-1]
    return base


def stem(word: str) -> str:
    """Light rule-based suffix stripping (Porter-flavoured, deterministic)."""
    if len(word) <= 3:
        return word
    if word.endswith("ization"):
        return word[:-7] + "ize"
    if word.endswith("ational"):
        return word[:-7] + "ate"
    if word.endswith(("iveness", "fulness", "ousness")):
        return word[:-4]
    if word.endswith("ement"):
        return word[:-3]
    if word.endswith("ability"):
        return word[:-5]
    if word.endswith("arily"):
        return word[:-5]
    if word.endswith("ally") and len(word) > 6:
        return word[:-4]
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("sses"):
        return word[:-2]
    if word.endswith("ss"):
        return word
    if word.endswith("s") and not word.endswith("us") and len(word) > 4:
        return word[:-1]
    if word.endswith("ing") and len(word) > 5:
        return _consolidate_base(word[:-3])
    if word.endswith("ed") and len(word) > 5:
        return _consolidate_base(word[:-2])
    if word.endswith("ly") and len(word) > 5:
        return word[:-2]
    return word


def normalize(text) -> str:
    if not text:
        return ""
    lowered = str(text).lower()
    lowered = lowered.translate(_CURLY_SINGLE).translate(_DASHES)
    return re.sub(r"[^\w\s'+#.:/-]", " ", lowered, flags=re.A)


KEEP = frozenset(["node.js", "next.js", "c#", "vue.js", "react.js", "angular.js"])


def tokenize(text, keep_stopwords: bool = False):
    """Lowercase, punctuation-normalized, stopword-filtered, stemmed tokens.

    Well-known tech identifiers (node.js, c#, ...) survive intact.
    """
    cleaned = normalize(text)
    raw = [t for t in cleaned.split() if t]
    out = []
    for tok in raw:
        dotted = _STRIP_DASHES_RE.sub("", tok)
        if dotted in KEEP or _KEEP_RE.match(dotted):
            out.append(dotted)
            continue
        for word in [w for w in _SPLIT_RE.split(dotted) if w]:
            if not _WORD_RE.match(word) or len(word) < 2:
                continue
            if STOPWORD_PREFIXES.match(word):
                continue
            if not keep_stopwords and word in STOPWORDS:
                continue
            out.append(stem(word))
    return out


def words_for_display(text) -> list:
    """Unstemmed, lightly normalized words minus stopwords (for citations)."""
    return [w for w in normalize(text).split() if w and w not in STOPWORDS]


def is_stopword(word: str) -> bool:
    return word in STOPWORDS
