"""No-text-loss guarantees: the final remainder must never be silently dropped
and no chunk may exceed max_chars."""

from app.rag.chunker import chunk_text


def _line(char, length, sentinel):
    return char * length + sentinel


def test_keeps_short_tail_remainder_as_its_own_chunk():
    text = "\n".join([_line("a", 57, ".AA"), _line("b", 57, ".BB"), _line("c", 57, ".CC")])
    chunks = chunk_text(text, max_chars=100, min_chars=90)
    all_text = "\n".join(c["text"] for c in chunks)
    assert ".AA" in all_text
    assert ".BB" in all_text
    assert ".CC" in all_text  # previously dropped
    for c in chunks:
        assert len(c["text"]) <= 100


def test_merges_tail_remainder_into_last_chunk_when_it_fits():
    text = "\n".join([_line("a", 40, ".AA"), _line("b", 40, ".BB"), _line("c", 30, ".CC")])
    chunks = chunk_text(text, max_chars=120, min_chars=45)
    last = chunks[-1]
    assert ".CC" in last["text"]
    assert ".BB" in last["text"]  # merged remainder keeps the tail together
    for c in chunks:
        assert len(c["text"]) <= 120


def test_loses_no_sentinel_across_long_multi_section_document():
    text = "\n".join(
        [
            "# Section One",
            _line("x", 200, " ALPHA_START "),
            "## Section Two",
            _line("y", 300, " MIDWAY_GUARD "),
            "## Deployment",
            _line("z", 640, " OMEGA_END."),
        ]
    )
    chunks = chunk_text(text, max_chars=700, min_chars=120)
    all_text = "\n".join(c["text"] for c in chunks)
    assert "ALPHA_START" in all_text
    assert "MIDWAY_GUARD" in all_text
    assert "OMEGA_END" in all_text
    for c in chunks:
        assert len(c["text"]) <= 700
