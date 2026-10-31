from app.rag.tokenizer import is_stopword, normalize, stem, tokenize, words_for_display


def test_lowercases_removes_punctuation_and_stopwords():
    assert tokenize("The Quick, and Brown FOX!") == ["quick", "brown", "fox"]


def test_splits_dotted_identifiers_but_keeps_known_tech_names():
    assert tokenize("react.js was used with node.js") == ["react.js", "used", "node.js"]


def test_stems_common_suffixes():
    assert tokenize("running studies cactuses")[0] == "run"
    assert stem("running") == "run"
    assert stem("studies") == "study"
    assert stem("building") == "build"
    assert stem("raining") == "rain"


def test_returns_empty_for_empty_or_stopword_only_input():
    assert tokenize("") == []
    assert tokenize("the a of and") == []


def test_handles_none_input():
    assert tokenize(None) == []


def test_splits_slash_tokens_dropping_single_char_fragments():
    assert tokenize("python/r") == ["python"]
    assert tokenize("node/backend")[1] == "backend"


def test_normalize_strips_unicode_punctuation_variants():
    assert normalize("HELLO – World!") == "hello - world "


def test_words_for_display_returns_unstemmed_meaningful_words():
    words = words_for_display("I trained models with TensorFlow")
    assert "trained" in words
    assert "tensorflow" in words
    assert "with" not in words


def test_is_stopword_classifies_correctly():
    assert is_stopword("the") is True
    assert is_stopword("tensorflow") is False
