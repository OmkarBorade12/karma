"""Integration tests: full API lifecycle over an in-memory MongoDB."""

import pytest

RESUME_TEXT = "\n".join(
    [
        "Alex Sharma",
        "MERN + AIML developer",
        "alex.sharma@example.com | github.com/alexsharma",
        "",
        "PROJECTS",
        "LinguaSwift Translator (2023 - 2024)",
        "- Built a translation app in React with an Express API backed by MongoDB.",
        "- Deployed on Vercel with CI from GitHub Actions.",
        "",
        "SKILLS",
        "React, Node.js, Express, MongoDB, Python, TF-IDF, testing, git",
    ]
)


# ── health & bootstrap ───────────────────────────────────────────────────────


def test_health_reports_ok_and_autopilot_status(seeded_client):
    res = seeded_client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["ok"] is True
    assert "scheduled" in res.json()["autopilot"]
    assert "running" in res.json()["autopilot"]


def test_ensure_seeded_is_idempotent_on_populated_db(seeded_client):
    import asyncio

    from app.services.bootstrap import ensure_seeded

    second = asyncio.run(ensure_seeded())
    assert second["seeded"] is False


# ── profile endpoints ────────────────────────────────────────────────────────


def test_get_profile_returns_seeded_profile(seeded_client):
    res = seeded_client.get("/api/profile")
    assert res.status_code == 200
    assert res.json()["profile"] is not None
    assert "name" in res.json()["profile"]


def test_put_profile_updates_fields(seeded_client):
    res = seeded_client.put("/api/profile", json={"name": "Updated Name", "location": "Pune"})
    assert res.status_code == 200
    assert res.json()["profile"]["name"] == "Updated Name"
    back = seeded_client.get("/api/profile")
    assert back.json()["profile"]["location"] == "Pune"


def test_put_profile_rejects_empty_payloads(seeded_client):
    res = seeded_client.put("/api/profile", json={})
    assert res.status_code == 400
    assert "No updatable fields" in res.json()["error"]


# ── document ingestion → RAG ─────────────────────────────────────────────────


def test_post_documents_ingests_and_chunks(seeded_client):
    res = seeded_client.post(
        "/api/documents",
        json={
            "title": "Internship at NeuraWorks",
            "content": (
                "Internship at NeuraWorks (2025).\n- Worked on a data pipeline in Python "
                "for cleaning the training data of the image classification model.\n"
                "- Built an internal dashboard for the API metrics in React."
            ),
            "sourceType": "experience",
        },
    )
    assert res.status_code == 201
    assert res.json()["document"]["chunkCount"] > 0
    assert res.json()["chunkCount"] == res.json()["document"]["chunkCount"]


def test_documents_validates_title_content_source_type(seeded_client):
    no_title = seeded_client.post("/api/documents", json={"content": "Valid content here"})
    assert no_title.status_code == 400

    short_content = seeded_client.post("/api/documents", json={"title": "T", "content": "tiny"})
    assert short_content.status_code == 400

    bad_type = seeded_client.post(
        "/api/documents", json={"title": "T", "content": "Valid content here", "sourceType": "bogus"}
    )
    assert bad_type.status_code == 400


def test_ask_answers_from_ingested_experience_with_citations(seeded_client):
    res = seeded_client.post("/api/ask", json={"question": "What pipeline work did I do in Python?"})
    assert res.status_code == 200
    body = res.json()
    assert "pipeline" in body["answer"].lower()
    assert len(body["references"]) > 0
    assert body["metrics"]["corpusSize"] > 0


def test_ask_rejects_empty_question(seeded_client):
    res = seeded_client.post("/api/ask", json={"question": "  "})
    assert res.status_code == 400


def test_delete_document_removes_doc_and_deindexes_chunks(seeded_client):
    docs = seeded_client.get("/api/documents").json()["documents"]
    doc = next(d for d in docs if d["title"] == "Internship at NeuraWorks")

    before = seeded_client.get("/api/health")
    assert before.status_code == 200

    res = seeded_client.delete(f"/api/documents/{doc['_id']}")
    assert res.status_code == 200
    assert res.json()["chunksRemoved"] > 0

    after = seeded_client.post("/api/ask", json={"question": "NeuraWorks internship data pipeline"})
    assert after.status_code == 200
    assert "NeuraWorks" not in str(after.json()["references"])


# ── resume parsing API ───────────────────────────────────────────────────────


def test_profile_parse_returns_preview_without_writing(seeded_client):
    res = seeded_client.post("/api/profile/parse", json={"content": RESUME_TEXT})
    assert res.status_code == 200
    assert res.json()["profile"]["name"] == "Alex Sharma"
    assert len(res.json()["experiences"]) > 0


def test_profile_parse_rejects_short_content(seeded_client):
    res = seeded_client.post("/api/profile/parse", json={"content": "short"})
    assert res.status_code == 400


def test_profile_parse_commit_persists_and_indexes(seeded_client):
    res = seeded_client.post("/api/profile/parse/commit", json={"content": RESUME_TEXT})
    assert res.status_code == 201
    assert res.json()["count"] > 0
    assert res.json()["experiencesCreated"][0]["chunks"] > 0

    ask_res = seeded_client.post(
        "/api/ask", json={"question": "Tell me about LinguaSwift Translator project"}
    )
    assert ask_res.status_code == 200
    assert "LinguaSwift" in (ask_res.json()["answer"] + str(ask_res.json()["references"]))

    exp = seeded_client.get("/api/experience")
    assert any("LinguaSwift" in e["title"] for e in exp.json()["experiences"])


def test_profile_parse_commit_is_idempotent(seeded_client):
    res = seeded_client.post("/api/profile/parse/commit", json={"content": RESUME_TEXT})
    assert res.status_code == 409
    assert res.json()["count"] == 0
    assert "already committed" in res.json()["error"]

    exp = seeded_client.get("/api/experience")
    lingua = [e for e in exp.json()["experiences"] if "LinguaSwift" in e["title"]]
    assert len(lingua) == 1  # still exactly one entry


def test_profile_parse_commit_returns_422_when_nothing_parses(seeded_client):
    res = seeded_client.post(
        "/api/profile/parse/commit",
        json={
            "content": "A quiet diary entry about weather observations and errands, "
            "with no resume structure at all."
        },
    )
    assert res.status_code == 422
    assert "could not parse" in res.json()["error"].lower()


# ── experience analytics ─────────────────────────────────────────────────────


def test_get_experience_returns_entries_and_analytics(seeded_client):
    res = seeded_client.get("/api/experience")
    assert res.status_code == 200
    assert res.json()["analytics"]["total"] > 0
    assert len(res.json()["analytics"]["topSkills"]) > 0
    assert res.json()["analytics"]["kindCounts"].get("project", 0) > 0


def test_post_experience_creates_and_auto_indexes(seeded_client):
    res = seeded_client.post(
        "/api/experience",
        json={
            "title": "ZkBoard Cryptography Project",
            "kind": "project",
            "description": "Built a zk-proof demo board with Node backend and WebCrypto signatures.",
            "skills": ["cryptography", "node", "webcrypto"],
        },
    )
    assert res.status_code == 201
    assert res.json()["documentsCreated"] == 1

    ask_res = seeded_client.post(
        "/api/ask", json={"question": "cryptography webcrypto proof board experience?"}
    )
    combined = ask_res.json()["answer"] + str(ask_res.json()["references"])
    assert "ZkBoard" in combined


def test_post_experience_validates_title_and_kind(seeded_client):
    no_title = seeded_client.post("/api/experience", json={"description": "x"})
    assert no_title.status_code == 400

    bad_kind = seeded_client.post("/api/experience", json={"title": "T", "kind": "gig"})
    assert bad_kind.status_code == 400


# ── autopilot lifecycle ──────────────────────────────────────────────────────


def test_agent_run_executes_full_dda_cycle(seeded_client):
    res = seeded_client.post("/api/agent/run")
    assert res.status_code == 200
    run = res.json()["run"]
    assert run["status"] == "success"
    assert run["trigger"] == "manual"
    assert [s["phase"] for s in run["steps"]] == ["discover", "digest", "augment"]
    assert run["stats"]["reportsCreated"] > 0
    assert run["durationMs"] > 0


def test_second_agent_run_is_also_successful(seeded_client):
    res = seeded_client.post("/api/agent/run")
    assert res.json()["run"]["status"] == "success"


def test_reports_list_generated_reports_with_kinds(seeded_client):
    res = seeded_client.get("/api/reports")
    assert res.status_code == 200
    kinds = {r["kind"] for r in res.json()["reports"]}
    assert "skill-gap" in kinds
    assert "trajectory" in kinds
    assert "retrieval-quality" in kinds


def test_reports_filter_by_kind(seeded_client):
    res = seeded_client.get("/api/reports", params={"kind": "skill-gap"})
    assert len(res.json()["reports"]) > 0
    assert all(r["kind"] == "skill-gap" for r in res.json()["reports"])


def test_runs_list_run_history(seeded_client):
    res = seeded_client.get("/api/runs")
    assert res.status_code == 200
    assert len(res.json()["runs"]) > 0


def test_autopilot_control_start_status_stop(seeded_client):
    start = seeded_client.post("/api/agent/autopilot/start", json={"cron": "*/30 * * * *"})
    assert start.status_code == 200
    assert start.json()["started"] is True

    again = seeded_client.post("/api/agent/autopilot/start", json={"cron": "*/30 * * * *"})
    assert again.json()["started"] is False

    status = seeded_client.get("/api/agent/status")
    assert status.json()["scheduled"] is True

    stop = seeded_client.post("/api/agent/autopilot/stop")
    assert stop.json()["stopped"] is True


def test_rejects_invalid_cron_expression(seeded_client):
    res = seeded_client.post("/api/agent/autopilot/start", json={"cron": "not a cron"})
    assert res.status_code == 400
    assert "Invalid cron" in res.json()["error"]


# ── RAG quality gates ────────────────────────────────────────────────────────


def test_answers_skill_questions_about_seeded_corpus(seeded_client):
    res = seeded_client.post(
        "/api/ask", json={"question": "What skills do I have in machine learning?"}
    )
    assert res.json()["confidence"] > 0
    assert any(
        w in res.json()["answer"].lower() for w in ["python", "numpy", "pandas", "scikit"]
    )


def test_handles_out_of_corpus_questions_gracefully(seeded_client):
    res = seeded_client.post(
        "/api/ask", json={"question": "What is my experience with quantum teleportation?"}
    )
    assert res.status_code == 200
    assert res.json()["answer"]
