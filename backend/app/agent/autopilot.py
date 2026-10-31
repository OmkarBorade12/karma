"""KARMA AUTOPILOT — the autonomous core (APScheduler cron agent).

Continuous DDA cycle, no human in the loop:
  DISCOVER — analyze the memory index and experience corpus to find gaps
             (un-narrated experiences, evidence-free skills, weak retrieval).
  DIGEST   — autonomously generate insight reports (skill-gap, trajectory,
             retrieval-quality) and interview-style Q&A pairs.
  AUGMENT  — write the generated knowledge back into the RAG index so every
             future cycle retrieves better than the last (self-improving).

Every cycle is recorded as an agent run with per-step timings and stats.
"""

import asyncio
import math
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from ..db import get_db
from ..evaluation.retrieval_eval import evaluate_probes
from ..models import COLLECTIONS, now_utc
from ..rag.retriever import retrieve
from ..services.rag_index import deindex_document, get_corpus, index_document

TARGET_CAPABILITIES = [
    "python", "numpy", "pandas", "scikit-learn", "fastapi", "qdrant", "redis",
    "mongodb", "motor", "rest", "rag", "embeddings", "bm25", "tf-idf",
    "chunking", "reranking", "docker", "git", "testing", "jwt", "deployment",
    "sql", "apis", "machine learning", "model evaluation", "apscheduler",
    "gemini",
]

_scheduler_state = {"job": None, "running": False}


class CronError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.status = 400


def render_experience_as_text(e: dict) -> str:
    lines = [
        f"title: {e.get('title', '')}",
        f"organization: {e['organization']}" if e.get("organization") else None,
        f"type: {e.get('kind', 'project')}{' (ongoing)' if e.get('ongoing') else ''}",
        f"project: {e['description']}" if e.get("description") else None,
        (
            "highlights:\n" + "\n".join(f"- {h}" for h in e["highlights"])
            if e.get("highlights")
            else None
        ),
        f"skills: {', '.join(e['skills'])}" if e.get("skills") else None,
        f"outcome: {e['outcome']}" if e.get("outcome") else None,
    ]
    return "\n".join(l for l in lines if l is not None)


def _format_date(d) -> str | None:
    if not d:
        return None
    if isinstance(d, str):
        return d[:10]
    return d.astimezone(timezone.utc).date().isoformat()


async def _find_documents(filter: dict, projection: dict | None = None):
    db = get_db()
    return [d async for d in db[COLLECTIONS["documents"]].find(filter, projection)]


# ── DISCOVER ─────────────────────────────────────────────────────────────────


async def discover() -> dict:
    db = get_db()
    corpus = await get_corpus()
    experiences = [
        d
        async for d in db[COLLECTIONS["experiences"]]
        .find()
        .sort([("startDate", -1), ("createdAt", -1)])
    ]
    profile = await db[COLLECTIONS["profiles"]].find_one({})
    existing_qa_docs = await db[COLLECTIONS["documents"]].count_documents({"sourceType": "qa"})

    corpus_text = "\n".join(c["text"] for c in corpus).lower()

    skill_set = set()
    for e in experiences:
        skill_set.update(e.get("skills") or [])
    uncovered_skills = [
        s for s in sorted(skill_set) if str(s).lower() not in corpus_text
    ]

    missing_capabilities = [c for c in TARGET_CAPABILITIES if c not in corpus_text]

    experience_docs = await _find_documents(
        {"sourceType": "experience"}, {"title": 1, "metadata": 1}
    )
    indexed_ids = {str((d.get("metadata") or {}).get("experienceId") or "") for d in experience_docs}
    unindexed_experiences = [e for e in experiences if str(e["_id"]) not in indexed_ids]

    needs_qa_generation = existing_qa_docs < math.ceil(len(experiences) / 2)

    probes = _build_probes(experiences, profile)
    probe_results = _probe_retrieval(corpus, probes)

    return {
        "corpusSize": len(corpus),
        "experienceCount": len(experiences),
        "hasProfile": bool(profile),
        "uncoveredSkills": uncovered_skills,
        "missingCapabilities": missing_capabilities,
        "unindexedExperiences": unindexed_experiences,
        "needsQaGeneration": needs_qa_generation,
        "probes": probes,
        "probeResults": probe_results,
        "experiences": experiences,
        "profile": profile,
    }


def _build_probes(experiences, profile, max_probes: int = 5) -> list:
    probes, seen = [], set()
    for e in experiences:
        for skill in (e.get("skills") or [])[:2]:
            if skill in seen:
                continue
            seen.add(skill)
            probes.append(f"What experience do I have with {skill}?")
            if len(probes) >= max_probes:
                return probes
    if profile and profile.get("name") and len(seen) < max_probes:
        probes.append("Who am I and what is my professional background?")
    return probes[:max_probes]


def _probe_retrieval(corpus, probes) -> list:
    results = []
    for q in probes:
        hits = retrieve(q, corpus, top_k=3)
        coverage = (
            sum(h.get("coverage") or 0 for h in hits) / len(hits) if hits else 0.0
        )
        results.append(
            {
                "question": q,
                "hits": len(hits),
                "coverage": coverage,
                "healthy": bool(hits) and coverage >= 0.25,
            }
        )
    return results


# ── DIGEST ───────────────────────────────────────────────────────────────────


async def _create_report(db, payload: dict) -> dict:
    doc = {
        **payload,
        "autonomouslyGenerated": True,
        "createdAt": now_utc(),
        "updatedAt": now_utc(),
    }
    result = await db[COLLECTIONS["reports"]].insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def digest(discovery: dict) -> dict:
    db = get_db()
    reports = []

    corpus = await get_corpus()
    corpus_text = "\n".join(c["text"] for c in corpus).lower()
    observed = [c for c in TARGET_CAPABILITIES if c in corpus_text]
    coverage_pct = round(len(observed) / len(TARGET_CAPABILITIES) * 100)
    missing = discovery["missingCapabilities"]
    reports.append(
        await _create_report(
            db,
            {
                "kind": "skill-gap",
                "title": f"Skill-gap analysis vs AIML+RAG target profile ({coverage_pct}% coverage)",
                "summary": (
                    f"The memory index currently evidences {len(observed)}/"
                    f"{len(TARGET_CAPABILITIES)} target capabilities. "
                    + (
                        f"No evidence found for: {', '.join(missing)}."
                        if missing
                        else "All target capabilities are evidenced in the experience corpus."
                    )
                ),
                "body": {
                    "observed": observed,
                    "missing": missing,
                    "uncoveredDeclaredSkills": discovery["uncoveredSkills"],
                    "advice": (
                        f"Next best additions to the experience corpus: {', '.join(missing[:4])}"
                        if missing[:4]
                        else "Coverage is complete for the current target profile."
                    ),
                },
                "metrics": {
                    "coveragePct": coverage_pct,
                    "observedCount": len(observed),
                    "targetCount": len(TARGET_CAPABILITIES),
                },
                "derivedFrom": [],
            },
        )
    )

    kind_counts = {}
    skill_frequency = {}
    for e in discovery["experiences"]:
        kind_counts[e.get("kind", "project")] = kind_counts.get(e.get("kind", "project"), 0) + 1
        for s in e.get("skills") or []:
            key = s.lower()
            skill_frequency[key] = skill_frequency.get(key, 0) + 1
    top_skills = [
        {"skill": skill, "count": count}
        for skill, count in sorted(skill_frequency.items(), key=lambda kv: kv[1], reverse=True)[:8]
    ]
    date_spans = sorted(
        _format_date(e.get("startDate"))
        for e in discovery["experiences"]
        if e.get("startDate")
    )
    date_spans = [d for d in date_spans if d]
    kind_summary = ", ".join(f"{k} × {n}" for k, n in kind_counts.items()) or "no entries"
    reports.append(
        await _create_report(
            db,
            {
                "kind": "trajectory",
                "title": f"Experience trajectory overview ({len(discovery['experiences'])} entries)",
                "summary": (
                    f"Distribution by type: {kind_summary}. "
                    "Core recurring skills: "
                    + ", ".join(t["skill"] for t in top_skills[:5])
                    + "."
                ),
                "body": {
                    "kindCounts": kind_counts,
                    "topSkills": top_skills,
                    "earliestEntry": date_spans[0] if date_spans else None,
                    "latestEntry": date_spans[-1] if date_spans else None,
                },
                "metrics": {"entryCount": len(discovery["experiences"])},
                "derivedFrom": [e["_id"] for e in discovery["experiences"]],
            },
        )
    )

    # Retrieval-quality self-evaluation, computed via the Pandas/NumPy evaluator.
    evaluation = evaluate_probes(
        corpus, discovery["probes"], top_k=3
    ) if discovery["probes"] else {"metrics": {"totalProbes": 0, "healthyProbes": 0, "avgCoverage": 0.0}}
    eval_metrics = evaluation["metrics"]
    healthy = eval_metrics.get("healthyProbes", 0)
    total = eval_metrics.get("totalProbes", 0)
    avg_coverage = eval_metrics.get("avgCoverage", 0.0)
    reports.append(
        await _create_report(
            db,
            {
                "kind": "retrieval-quality",
                "title": f"Retrieval self-evaluation ({healthy}/{total} probes healthy)",
                "summary": (
                    f"The autopilot probed its own retriever with {total} questions "
                    f"derived from the corpus. Average query-term coverage: "
                    f"{avg_coverage * 100:.0f}%."
                ),
                "body": {
                    "probes": discovery["probeResults"],
                    "rankingMetrics": eval_metrics,
                },
                "metrics": {
                    "healthyProbes": healthy,
                    "totalProbes": total,
                    "avgCoverage": avg_coverage,
                    "mrr": eval_metrics.get("avgMrr", 0.0),
                    "ndcgAtK": eval_metrics.get("avgNdcgAtK", 0.0),
                },
                "derivedFrom": [],
            },
        )
    )

    return {"reports": reports}


def generate_qa_pairs(experiences, max_pairs: int = 6) -> list:
    def pick(arr):
        return arr[len(arr) // 2] if arr else None

    pairs = []
    for e in experiences:
        if len(pairs) >= max_pairs:
            break
        skill = pick(e.get("skills") or [])
        highlight = pick(e.get("highlights") or [])
        if skill and highlight:
            pairs.append(
                {"question": f"Tell me about your work with {skill}.", "answer": highlight, "source": e["title"]}
            )
    for e in experiences[: max(1, max_pairs - len(pairs))]:
        if len(pairs) >= max_pairs:
            break
        answer = e.get("description") or ((e.get("highlights") or [""])[0] or "")
        pairs.append(
            {
                "question": f'Describe the "{e["title"]}" {e.get("kind", "project")}.',
                "answer": answer,
                "source": e["title"],
            }
        )
    return [p for p in pairs if p.get("answer")]


# ── AUGMENT ──────────────────────────────────────────────────────────────────


async def _create_document(db, payload: dict) -> dict:
    doc = {**payload, "createdAt": now_utc(), "updatedAt": now_utc()}
    result = await db[COLLECTIONS["documents"]].insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def _index_experience_entry(entry: dict) -> int:
    db = get_db()
    content = render_experience_as_text(entry)
    doc = await _create_document(
        db,
        {
            "title": entry["title"],
            "content": content,
            "sourceType": "experience",
            "metadata": {"experienceId": str(entry["_id"]), "kind": entry.get("kind", "project")},
            "chunkCount": 0,
            "autonomouslyGenerated": False,
        },
    )
    chunks = await index_document(
        document_id=doc["_id"], text=content, source_title=doc["title"], source_type="experience"
    )
    await db[COLLECTIONS["documents"]].update_one(
        {"_id": doc["_id"]}, {"$set": {"chunkCount": len(chunks)}}
    )
    return len(chunks)


async def _upsert_autonomous_document(title: str, source_type: str, content: str,
                                      metadata: dict) -> tuple[int, bool]:
    """Create or replace-in-place an autonomous doc (dedupe, no index bloat).

    Returns (chunks_indexed, created_new_document).
    """
    db = get_db()
    existing = await db[COLLECTIONS["documents"]].find_one({"title": title, "sourceType": source_type})
    if existing and existing.get("content") == content:
        return 0, False  # identical content already indexed — no-op
    if existing:
        await deindex_document(existing["_id"])
        chunks = await index_document(
            document_id=existing["_id"], text=content, source_title=title, source_type=source_type
        )
        merged_metadata = {**(existing.get("metadata") or {}), **metadata}
        await db[COLLECTIONS["documents"]].update_one(
            {"_id": existing["_id"]},
            {"$set": {"content": content, "chunkCount": len(chunks), "metadata": merged_metadata}},
        )
        return len(chunks), False
    doc = await _create_document(
        db,
        {
            "title": title,
            "content": content,
            "sourceType": source_type,
            "metadata": metadata,
            "chunkCount": 0,
            "autonomouslyGenerated": True,
        },
    )
    chunks = await index_document(
        document_id=doc["_id"], text=content, source_title=title, source_type=source_type
    )
    await db[COLLECTIONS["documents"]].update_one(
        {"_id": doc["_id"]}, {"$set": {"chunkCount": len(chunks)}}
    )
    return len(chunks), True


async def augment(discovery: dict, qa_pairs: list) -> dict:
    documents_augmented = 0
    chunks_indexed = 0

    for e in discovery["unindexedExperiences"]:
        chunks_indexed += await _index_experience_entry(e)
        documents_augmented += 1

    pairs = [p for p in (qa_pairs or []) if p and p.get("answer")]
    if discovery["needsQaGeneration"] and pairs:
        content = "\n\n".join(
            f"Q: {p['question']}\nA: {p['answer']}\n(source: {p['source']})" for p in pairs
        )
        indexed, created = await _upsert_autonomous_document(
            "Interview Preparation Q&A",
            "qa",
            content,
            {"generatedBy": "autopilot", "pairCount": len(pairs)},
        )
        chunks_indexed += indexed
        documents_augmented += 1 if created else 0

    if discovery["uncoveredSkills"]:
        evidence_lines = []
        for e in discovery["experiences"]:
            for s in e.get("skills") or []:
                if s in discovery["uncoveredSkills"]:
                    details = e.get("description") or "; ".join(e.get("highlights") or [])
                    org = f", {e['organization']}" if e.get("organization") else ""
                    evidence_lines.append(
                        f"Evidence for {s}: {e['title']} ({e.get('kind', 'project')}{org}). Details: {details}"
                    )
        if evidence_lines:
            content = "\n\n".join(evidence_lines)
            indexed, created = await _upsert_autonomous_document(
                "Skill-Evidence Notes (autopilot enrichment)",
                "insight",
                content,
                {"generatedBy": "autopilot", "skillCount": len(discovery["uncoveredSkills"])},
            )
            chunks_indexed += indexed
            documents_augmented += 1 if created else 0

    return {"documentsAugmented": documents_augmented, "chunksIndexed": chunks_indexed}


# ── CYCLE ────────────────────────────────────────────────────────────────────


async def run_cycle(trigger: str = "manual", phases: dict | None = None) -> dict:
    db = get_db()
    phases = phases or {}
    phase_discover = phases.get("discover", discover)
    phase_digest = phases.get("digest", digest)
    phase_augment = phases.get("augment", augment)

    t0 = datetime.now(timezone.utc)
    run = {
        "trigger": trigger,
        "status": "running",
        "startedAt": now_utc(),
        "finishedAt": None,
        "durationMs": 0,
        "steps": [],
        "stats": {
            "chunksIndexed": 0,
            "reportsCreated": 0,
            "documentsAugmented": 0,
            "questionsEvaluated": 0,
        },
        "issues": [],
        "createdAt": now_utc(),
        "updatedAt": now_utc(),
    }
    result = await db[COLLECTIONS["agent_runs"]].insert_one(run)
    run["_id"] = result.inserted_id

    errors = []
    stats = run["stats"]
    current_phase = "discover"

    async def save():
        await db[COLLECTIONS["agent_runs"]].update_one(
            {"_id": run["_id"]},
            {"$set": {"steps": run["steps"], "stats": stats, "status": run["status"],
                      "issues": errors, "finishedAt": run["finishedAt"],
                      "durationMs": run["durationMs"], "updatedAt": now_utc()}},
        )

    def push_step(phase, action, detail, success=True, duration_ms=0):
        run["steps"].append(
            {"phase": phase, "action": action, "detail": detail,
             "success": success, "durationMs": duration_ms}
        )

    try:
        current_phase = "discover"
        t = datetime.now(timezone.utc)
        discovery = await phase_discover()
        discover_ms = int((datetime.now(timezone.utc) - t).total_seconds() * 1000)
        if discovery.get("hasProfile") is False:
            errors.append("No profile present in database.")
        push_step(
            "discover",
            f"Analyzed index ({discovery['corpusSize']} chunks) and "
            f"{discovery['experienceCount']} experience entries",
            {
                "uncoveredSkills": len(discovery["uncoveredSkills"]),
                "unindexedExperiences": len(discovery["unindexedExperiences"]),
                "probes": len(discovery["probeResults"]),
            },
            True,
            discover_ms,
        )
        stats["questionsEvaluated"] = len(discovery["probeResults"])
        await save()

        current_phase = "digest"
        qa_pairs = generate_qa_pairs(discovery["experiences"])
        t = datetime.now(timezone.utc)
        digest_result = await phase_digest(discovery)
        digest_ms = int((datetime.now(timezone.utc) - t).total_seconds() * 1000)
        push_step(
            "digest",
            f"Generated {len(digest_result['reports'])} insight reports + "
            f"{len(qa_pairs)} interview Q&A pairs",
            {
                "reportKinds": [r["kind"] for r in digest_result["reports"]],
                "qaPairs": len(qa_pairs),
            },
            True,
            digest_ms,
        )
        await save()

        current_phase = "augment"
        t = datetime.now(timezone.utc)
        augment_result = await phase_augment(discovery, qa_pairs)
        augment_ms = int((datetime.now(timezone.utc) - t).total_seconds() * 1000)
        push_step(
            "augment",
            f"Indexed {augment_result['chunksIndexed']} new chunks across "
            f"{augment_result['documentsAugmented']} self-authored sources",
            augment_result,
            True,
            augment_ms,
        )
        stats["chunksIndexed"] = augment_result["chunksIndexed"]
        stats["documentsAugmented"] = augment_result["documentsAugmented"]
        stats["reportsCreated"] = len(digest_result["reports"])
    except Exception as err:  # noqa: BLE001 — every failure is recorded, never fatal
        errors.append(str(err))
        push_step(current_phase, f"phase failed: {current_phase}", {"error": str(err)}, False)
        try:
            await save()
        except Exception:
            pass

    finished = now_utc()
    run["stats"] = stats
    run["issues"] = errors
    run["status"] = (
        "partial" if (errors and stats["reportsCreated"]) else "failed" if errors else "success"
    )
    run["finishedAt"] = finished
    run["durationMs"] = int((finished - t0).total_seconds() * 1000)
    await save()
    return run


# ── SCHEDULER (APScheduler) ──────────────────────────────────────────────────


def is_running() -> bool:
    return _scheduler_state["running"]


def is_scheduled() -> bool:
    return _scheduler_state["job"] is not None


def start_scheduled(cron_expr: str) -> bool:
    """Schedule the DDA cycle with APScheduler. Returns False if already set."""
    if _scheduler_state["job"] is not None:
        return False
    try:
        trigger = CronTrigger.from_crontab(cron_expr)
    except ValueError as err:
        raise CronError(f"Invalid cron expression: {cron_expr} ({err})") from err

    scheduler = BackgroundScheduler()

    async def tick():
        if _scheduler_state["running"]:
            return  # never overlap cycles
        _scheduler_state["running"] = True
        try:
            await run_cycle(trigger="schedule")
        finally:
            _scheduler_state["running"] = False

    loop = asyncio.get_running_loop()

    def job():
        asyncio.run_coroutine_threadsafe(tick(), loop)

    scheduler.add_job(job, trigger)
    scheduler.start()
    _scheduler_state["job"] = scheduler
    return True


def stop_scheduled() -> bool:
    if _scheduler_state["job"] is None:
        return False
    try:
        _scheduler_state["job"].shutdown(wait=False)
    except Exception:
        pass
    _scheduler_state["job"] = None
    return True


class _SchedulerNamespace:
    """node-cron parity: scheduler.* helpers used by routes and tests."""

    start_scheduled = staticmethod(start_scheduled)
    stop_scheduled = staticmethod(stop_scheduled)
    is_scheduled = staticmethod(is_scheduled)
    is_running = staticmethod(is_running)


scheduler = _SchedulerNamespace()
