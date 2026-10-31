"""Autopilot self-augmentation guarantees: no duplicate QA/evidence documents
across cycles, in-place updates when experiences change, failing phases
recorded in run.steps."""

import pytest


@pytest.fixture
def autopilot():
    from app.agent import autopilot as module

    return module


async def test_does_not_duplicate_qa_document_across_cycles(db, autopilot):
    from app.services.bootstrap import ensure_seeded

    await ensure_seeded()

    run1 = await autopilot.run_cycle(trigger="manual")
    assert run1["status"] == "success"

    count1 = await db.documents.count_documents({"sourceType": "qa"})
    assert count1 == 1

    run2 = await autopilot.run_cycle(trigger="manual")
    assert run2["status"] == "success"

    count2 = await db.documents.count_documents({"sourceType": "qa"})
    assert count2 == 1  # previously grew by 1 per cycle (unbounded)


async def test_updates_qa_document_in_place_when_experiences_change(db, autopilot, client):
    from app.services.bootstrap import ensure_seeded

    await ensure_seeded()
    await db.experiences.insert_one(
        {
            "title": "Extra Matrix Ops",
            "organization": "",
            "kind": "project",
            "description": "Practised matrix algebra and eigen decompositions for gradient descent stability.",
            "startDate": None,
            "endDate": None,
            "ongoing": False,
            "skills": ["linear algebra", "eigen-decomposition"],
            "highlights": ["Derived eigenvalue bounds for learning-rate tuning."],
            "outcome": "",
        }
    )

    run3 = await autopilot.run_cycle(trigger="manual")
    assert run3["status"] == "success"

    qa_docs = [d async for d in db.documents.find({"sourceType": "qa"})]
    assert len(qa_docs) == 1  # updated, not duplicated
    assert (qa_docs[0].get("metadata") or {}).get("pairCount", 0) > 0

    ask = client.post(
        "/api/ask",
        json={"question": "linear algebra eigen decompositions gradient descent"},
    )
    assert ask.status_code == 200
    references = str(ask.json()["references"]) + ask.json()["answer"]
    assert any(w in references for w in ["Matrix", "linear algebra", "eigen"])


async def test_records_failing_phase_in_run_steps(autopilot):
    from app.services.bootstrap import ensure_seeded

    await ensure_seeded()

    async def boom_digest(discovery):
        raise RuntimeError("boom digest")

    run = await autopilot.run_cycle(trigger="manual", phases={"digest": boom_digest})
    assert run["status"] == "failed"
    failed_step = next(s for s in run["steps"] if not s["success"])
    assert failed_step["phase"] == "digest"
    assert "boom digest" in failed_step["detail"]["error"]


def test_health_reports_database_state(seeded_client):
    res = seeded_client.get("/api/health")
    assert res.json()["db"] in ("connected", "in-memory")
