from app.services.profile_parser import parse_date_heuristic, parse_resume

SAMPLE_RESUME = "\n".join(
    [
        "Jane Doe",
        "Full-Stack Developer | RAG enthusiast",
        "jane.doe@example.com | github.com/janedoe | linkedin.com/in/janedoe | janedoe.dev",
        "",
        "SUMMARY",
        "I build MERN apps and RAG pipelines. I love ML.",
        "",
        "SKILLS",
        "JavaScript, Python, React, Node.js, MongoDB, TF-IDF, unit testing",
        "",
        "EXPERIENCE",
        "Software Engineer Intern — TechCorp (Jun 2023 - Dec 2023)",
        "- Built 4 REST endpoints serving the reporting dashboard.",
        "- Reduced query time by 30% by indexing MongoDB collections.",
        "AI Ninja Project (2022 - 2023)",
        "- Implemented TF-IDF retrieval over study notes.",
        "",
        "EDUCATION",
        "B.Sc. Computer Science, ABC University (2020 - 2024)",
    ]
)


def test_extracts_contact_and_links():
    parsed = parse_resume(SAMPLE_RESUME)
    assert parsed["profile"]["email"] == "jane.doe@example.com"
    assert "github.com/janedoe" in parsed["profile"]["links"]["github"]
    assert "linkedin.com/in/janedoe" in parsed["profile"]["links"]["linkedin"]


def test_extracts_name_and_headline_from_top_lines():
    parsed = parse_resume(SAMPLE_RESUME)
    assert parsed["profile"]["name"] == "Jane Doe"
    assert "Full-Stack Developer" in parsed["profile"]["headline"]


def test_captures_summary_section():
    parsed = parse_resume(SAMPLE_RESUME)
    assert "MERN apps and RAG pipelines" in parsed["profile"]["summary"]


def test_parses_skills_line_into_list():
    parsed = parse_resume(SAMPLE_RESUME)
    for skill in ["JavaScript", "Python", "React", "Node.js", "MongoDB", "unit testing"]:
        assert skill in parsed["profile"]["skills"]


def test_creates_experience_entries_with_dates_bullets_and_kinds():
    parsed = parse_resume(SAMPLE_RESUME)
    assert len(parsed["experiences"]) >= 2

    intern = next(e for e in parsed["experiences"] if "Software Engineer Intern" in e["title"])
    assert intern["kind"] == "internship"
    assert intern["endDate"].year == 2023
    assert intern["startDate"].month == 6  # June
    assert len(intern["highlights"]) == 2
    assert not intern["highlights"][0].startswith("-")

    project = next(e for e in parsed["experiences"] if "AI Ninja" in e["title"])
    assert project["kind"] == "project"
    assert project["ongoing"] is False


def test_returns_empty_experiences_when_nothing_matches():
    out = parse_resume("Just some random text with no structure.")
    assert isinstance(out["experiences"], list)
    assert out["profile"]["email"] == ""


def test_handles_none_input():
    out = parse_resume(None)
    assert out["profile"]["name"] == ""
    assert out["experiences"] == []


def test_parse_date_month_year_range_with_present():
    d = parse_date_heuristic("Software Intern (Aug 2024 - Present)")
    assert d["ongoing"] is True
    assert d["end"] is None
    assert d["start"].month == 8


def test_parse_date_bare_year_ranges():
    d = parse_date_heuristic("GroCoder 2021 - 2023")
    assert d["start"].year == 2021
    assert d["end"].year == 2023
    assert d["ongoing"] is False


def test_parse_date_returns_none_when_no_dates():
    assert parse_date_heuristic("no dates here") is None
