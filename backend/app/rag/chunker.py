"""Structural document chunker with overlap and no-text-loss guarantees.

Port of the original chunker: heading-aware blocks, sliding sentence/list
windows with 1-unit overlap, hard word-boundary slicing for oversized units,
and final-remainder preservation (never silently dropped, never over maxChars).
"""

import os
import re

MAX_CHARS = int(os.environ.get("KARMA_CHUNK_MAX_CHARS", "700"))
MIN_CHARS = int(os.environ.get("KARMA_CHUNK_MIN_CHARS", "120"))

_HEADING_MD_RE = re.compile(r"^(#{1,6}\s+\S.*|[A-Z][A-Za-z0-9 ,'()&/.+-]{4,60}:)$")
_HEADING_KW_RE = re.compile(
    r"^(title|project|role|position|company|summary|highlights|selected|experience)\b.{0,60}:$",
    re.I,
)
_ABBREV_RE = re.compile(r"\b(Mr|Mrs|Dr|Jr|Sr|e\.g|i\.e|vs|approx|etc)\.?$", re.I)
_LIST_MARKER_RE = re.compile(r"^[-*\u2022]")


def split_sentences(text) -> list:
    out = []
    buf = ""
    text = str(text or "")
    for i, ch in enumerate(text):
        buf += ch
        if ch in ".!?":
            prev = text[i - 1] if i > 0 else ""
            nxt = text[i + 1] if i + 1 < len(text) else " "
            abbrev = re.search(r"[a-wyz]$", prev) and re.match(r"[A-Z0-9]", nxt)
            common_abbrev = _ABBREV_RE.search(buf.strip())
            decimal = re.search(r"\d$", prev) and re.match(r"\d\s", nxt + " ")
            if not abbrev and not common_abbrev and not decimal:
                out.append(buf.strip())
                buf = ""
    if buf.strip():
        out.append(buf.strip())
    return [s for s in out if s]


def hard_slice(sentence: str, max_chars: int) -> list:
    """Split an oversized sentence at word boundaries into pieces <= max_chars."""
    if len(sentence) <= max_chars:
        return [sentence]
    parts = []
    remaining = sentence.strip()
    while len(remaining) > max_chars:
        cut = remaining.rfind(" ", 0, max_chars + 1)
        if cut <= 0:
            cut = max_chars
        parts.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        parts.append(remaining)
    return [p for p in parts if p]


def is_heading(line: str) -> bool:
    line = line.strip()
    return bool(_HEADING_MD_RE.match(line) or _HEADING_KW_RE.match(line))


def _structural_blocks(text: str) -> list:
    lines = text.replace("\r\n", "\n").split("\n")
    blocks = []
    current = {"heading": "", "lines": []}
    for line in lines:
        if is_heading(line):
            if "".join(current["lines"]).strip():
                blocks.append(current)
            current = {"heading": re.sub(r"^#{1,6}\s+", "", line.strip()), "lines": []}
        else:
            current["lines"].append(line)
    if "".join(current["lines"]).strip():
        blocks.append(current)
    merged = [
        {"heading": b["heading"], "text": "\n".join(b["lines"]).strip()} for b in blocks
    ]
    if not merged:
        stripped = text.strip()
        if stripped:
            merged = [{"heading": "", "text": stripped}]
    return merged


def chunk_text(text, max_chars: int = None, min_chars: int = None) -> list:
    """Chunk a document into overlapping, self-contained passages.

    Returns [{text, heading, index}]; [] for blank input. The final remainder
    is merged into the last committed chunk when it fits, else kept as its own
    chunk — content is never dropped.
    """
    max_chars = MAX_CHARS if max_chars is None else max_chars
    min_chars = MIN_CHARS if min_chars is None else min_chars
    blocks = _structural_blocks(str(text or ""))
    chunks = []

    for block in blocks:
        if len(block["text"]) <= max_chars:
            if block["text"]:
                chunks.append({"text": block["text"], "heading": block["heading"]})
            continue

        units = []
        for line in block["text"].split("\n"):
            if not line.strip():
                continue
            if len(line) > max_chars:
                for sentence in split_sentences(line):
                    units.extend(hard_slice(sentence, max_chars))
            else:
                units.append(line.strip())

        committed = []
        window = []

        def window_len():
            return len("\n".join(window))

        for unit in units:
            if window and window_len() + 1 + len(unit) > max_chars:
                committed.append("\n".join(window))
                overlap = window[-1]
                window = [overlap] if len(overlap) + 1 <= max_chars / 2 else []
            window.append(unit)

        remainder = "\n".join(window).strip()
        if remainder:
            last = committed[-1] if committed else None
            if last is not None and len(last) + 1 + len(remainder) <= max_chars:
                committed[-1] = f"{last}\n{remainder}"
            else:
                committed.append(remainder)
        for piece in committed:
            chunks.append({"text": piece, "heading": block["heading"]})

    result = []
    for idx, c in enumerate(chunks):
        stripped = c["text"].strip()
        if stripped:
            result.append({"text": stripped, "heading": c["heading"], "index": idx})
    return result
