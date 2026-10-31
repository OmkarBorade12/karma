from app.rag.chunker import chunk_text, is_heading, split_sentences

LONG_TEXT = "\n".join(
    [
        "# Machine Learning",
        "Regression is about predicting continuous values. Classification assigns categories. Both need careful evaluation metrics such as precision, recall and F1.",
        "",
        "## Deep Learning",
        "Neural networks stack nonlinear layers. Training uses backpropagation with gradient descent. Overfitting is controlled with regularization and validation sets.",
        "",
        "## Deployment",
        "Models are served behind REST APIs. Monitoring catches drift.",
    ]
)


def test_split_sentences_on_boundaries():
    assert split_sentences("Ml is fun. RAG is hard! Right? No.") == [
        "Ml is fun.",
        "RAG is hard!",
        "Right?",
        "No.",
    ]


def test_split_sentences_preserves_decimals():
    s = split_sentences("Accuracy reached 0.95. Good model.")
    assert len(s) == 2
    assert s[0] == "Accuracy reached 0.95."
    assert s[1] == "Good model."


def test_split_sentences_keeps_abbreviation_interrupted_sentences_together():
    s = split_sentences("Dr. Vyas said ML works. Then left.")
    assert len(s) == 2
    assert "Dr. Vyas" in s[0]


def test_is_heading_detects_markdown_and_colon_headings():
    assert is_heading("## Projects") is True
    assert is_heading("SKILLS:") is True
    assert is_heading("just a normal sentence") is False


def test_chunk_text_produces_chunks_with_headings_preserved():
    chunks = chunk_text(LONG_TEXT)
    assert len(chunks) > 0
    headings = {c["heading"] for c in chunks}
    assert "Machine Learning" in headings
    assert "Deep Learning" in headings
    assert "Deployment" in headings


def test_chunk_text_indexes_chunks_sequentially():
    chunks = chunk_text(LONG_TEXT)
    assert [c["index"] for c in chunks] == list(range(len(chunks)))


def test_chunk_text_respects_max_chunk_size_with_overlap():
    paragraph = "A " * 800 + "END."
    chunks = chunk_text(paragraph, max_chars=200, min_chars=50)
    assert all(c["text"].__len__() <= 220 for c in chunks)
    assert len(chunks) > 3


def test_chunk_text_blank_input_and_single_sentence():
    assert chunk_text("   \n  ") == []
    assert len(chunk_text("One single line of experience.")) == 1


def test_chunk_text_never_merges_unrelated_sections_when_bounded():
    for c in chunk_text(LONG_TEXT):
        if c["heading"] == "Deployment":
            assert "REST APIs" in c["text"]
