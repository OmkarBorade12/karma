"""All REST routes for KARMA (FastAPI port of the original Express API)."""

import re

from bson import ObjectId
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..agent import autopilot
from ..db import db_state_label, get_db
from ..evaluation.retrieval_eval import evaluate_probes
from ..models import (
    COLLECTIONS,
    EXPERIENCE_KINDS,
    SOURCE_TYPES,
    now_utc,
    serialize_doc,
)
from ..services.ask_service import AskError, ask
from ..services.bootstrap import ensure_seeded
from ..services.profile_parser import parse_resume
from ..services.rag_index import deindex_document, index_document
from .errors import KarmaError

router = APIRouter(prefix="/api")

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@router.get("/health")
async def health():
    return {
        "ok": True,
        "db": db_state_label(),
        "autopilot": {
            "scheduled": autopilot.scheduler.is_scheduled(),
            "running": autopilot.scheduler.is_running(),
        },
        "time": now_utc().isoformat().replace("+00:00", "Z"),
    }


# ── PROFILE ──────────────────────────────────────────────────────────────────


@router.get("/profile")
async def get_profile():
    db = get_db()
    profile = await db[COLLECTIONS["profiles"]].find_one({})
    return {"profile": serialize_doc(profile)}


async def _update_profile(body: dict) -> dict:
    db = get_db()
    update = {}
    for key in ["name", "headline", "summary", "email", "location"]:
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            update[key] = value.strip()

    links = body.get("links")
    if isinstance(links, dict):
        existing = await db[COLLECTIONS["profiles"]].find_one({})
        merged = {**((existing or {}).get("links") or {})}
        for key in ["github", "linkedin", "portfolio"]:
            value = links.get(key)
            if isinstance(value, str):
                merged[key] = value.strip()
        update["links"] = merged

    if not update:
        raise KarmaError("No updatable fields provided", status=400)
    if update.get("email") and not EMAIL_RE.match(update["email"]):
        raise KarmaError("email is not a valid address", status=400)

    profile = await db[COLLECTIONS["profiles"]].find_one_and_update(
        {}, {"$set": {**update, "updatedAt": now_utc()}},
        upsert=True,
        return_document=True,
    )
    return {"profile": serialize_doc(profile)}


@router.post("/profile")
async def post_profile(request: Request):
    return await _update_profile(await _json_body(request))


@router.put("/profile")
async def put_profile(request: Request):
    return await _update_profile(await _json_body(request))


async def _json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


# ── DOCUMENTS (ingest) ───────────────────────────────────────────────────────


@router.get("/documents")
async def list_documents():
    db = get_db()
    cursor = db[COLLECTIONS["documents"]].find({}).sort("createdAt", -1)
    docs = []
    async for d in cursor:
        docs.append(
            {
                "_id": str(d["_id"]),
                "title": d.get("title"),
                "sourceType": d.get("sourceType"),
                "chunkCount": d.get("chunkCount", 0),
                "autonomouslyGenerated": d.get("autonomouslyGenerated", False),
                "metadata": d.get("metadata") or {},
                "createdAt": serialize_doc(d)["createdAt"],
            }
        )
    return {"documents": docs}


@router.post("/documents", status_code=201)
async def create_document(request: Request):
    db = get_db()
    body = await _json_body(request)
    title = body.get("title")
    content = body.get("content")
    source_type = body.get("sourceType", "note")

    if not title or not isinstance(title, str) or not title.strip():
        raise KarmaError("title is required", status=400)
    if not content or not isinstance(content, str) or len(content.strip()) < 10:
        raise KarmaError("content is required (min 10 chars)", status=400)
    if len(content) > 500000:
        raise KarmaError("content exceeds the maximum length of 500000 characters", status=400)
    if source_type not in SOURCE_TYPES:
        raise KarmaError(f"sourceType must be one of: {', '.join(SOURCE_TYPES)}", status=400)

    doc = {
        "title": title.strip(),
        "content": content,
        "sourceType": source_type,
        "metadata": body.get("metadata") or {},
        "chunkCount": 0,
        "autonomouslyGenerated": False,
        "createdAt": now_utc(),
        "updatedAt": now_utc(),
    }
    result = await db[COLLECTIONS["documents"]].insert_one(doc)
    doc["_id"] = result.inserted_id

    chunks = await index_document(
        document_id=doc["_id"], text=content, source_title=doc["title"], source_type=source_type
    )
    await db[COLLECTIONS["documents"]].update_one(
        {"_id": doc["_id"]}, {"$set": {"chunkCount": len(chunks)}}
    )
    doc["chunkCount"] = len(chunks)
    return {"document": serialize_doc(doc), "chunkCount": len(chunks)}


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    db = get_db()
    oid = ObjectId(document_id) if ObjectId.is_valid(document_id) else None
    doc = await db[COLLECTIONS["documents"]].find_one_and_delete({"_id": oid}) if oid else None
    if not doc:
        raise KarmaError("Document not found", status=404)
    removed = await deindex_document(doc["_id"])
    return {"deleted": doc["title"], "chunksRemoved": removed}


# ── RESUME PARSING ───────────────────────────────────────────────────────────


async def _require_resume_content(request: Request) -> str:
    body = await _json_body(request)
    content = body.get("content")
    if not content or not isinstance(content, str) or len(content.strip()) < 20:
        raise KarmaError("content is required (min 20 chars)", status=400)
    return content


@router.post("/profile/parse")
async def parse_profile(request: Request):
    content = await _require_resume_content(request)
    return parse_resume(content)


@router.post("/profile/parse/commit", status_code=201)
async def commit_parsed_profile(request: Request):
    db = get_db()
    content = await _require_resume_content(request)
    parsed = parse_resume(content)
    parsed_profile, experiences = parsed["profile"], parsed["experiences"]
    if not experiences:
        raise KarmaError(
            "Could not parse any experiences from the provided content", status=422
        )

    profile_update = {
        k: parsed_profile[k]
        for k in ["name", "headline", "summary", "email", "location"]
        if parsed_profile.get(k)
    }
    link_update = {
        k: parsed_profile["links"][k]
        for k in ["github", "linkedin", "portfolio"]
        if (parsed_profile.get("links") or {}).get(k)
    }
    if link_update:
        profile_update["links"] = link_update

    profile = None
    if profile_update:
        profile = await db[COLLECTIONS["profiles"]].find_one_and_update(
            {},
            {"$set": {**profile_update, "updatedAt": now_utc()}},
            upsert=True,
            return_document=True,
        )

    def _experience_dedupe_key(e: dict) -> str:
        start = e.get("startDate")
        if isinstance(start, str):
            start = start[:10]
        elif start is not None:
            start = start.date().isoformat() if hasattr(start, "date") else str(start)
        return f"{e.get('title')}||{e.get('organization') or ''}||{start or ''}"

    existing_rows = [d async for d in db[COLLECTIONS["experiences"]].find({}, {"title": 1, "organization": 1, "startDate": 1})]
    existing_keys = {_experience_dedupe_key(e) for e in existing_rows}
    new_experiences = [e for e in experiences if _experience_dedupe_key(e) not in existing_keys]
    if not new_experiences:
        return JSONResponse(
            status_code=409,
            content={
                "error": "Resume already committed — all parsed experiences already exist",
                "count": 0,
            },
        )

    created = []
    for e in new_experiences:
        entry = {
            **e,
            "createdAt": now_utc(),
            "updatedAt": now_utc(),
        }
        exp_result = await db[COLLECTIONS["experiences"]].insert_one(entry)
        entry["_id"] = exp_result.inserted_id

        content_text = autopilot.render_experience_as_text(entry)
        doc = {
            "title": e["title"],
            "content": content_text,
            "sourceType": "experience",
            "metadata": {"experienceId": str(entry["_id"]), "kind": entry["kind"]},
            "chunkCount": 0,
            "autonomouslyGenerated": False,
            "createdAt": now_utc(),
            "updatedAt": now_utc(),
        }
        doc_result = await db[COLLECTIONS["documents"]].insert_one(doc)
        chunks = await index_document(
            document_id=doc_result.inserted_id,
            text=content_text,
            source_title=e["title"],
            source_type="experience",
        )
        await db[COLLECTIONS["documents"]].update_one(
            {"_id": doc_result.inserted_id}, {"$set": {"chunkCount": len(chunks)}}
        )
        created.append({"experience": e["title"], "chunks": len(chunks)})

    return {
        "profile": serialize_doc(profile),
        "experiencesCreated": created,
        "count": len(created),
    }


# ── ASK (RAG) ────────────────────────────────────────────────────────────────


@router.post("/ask")
async def ask_question(request: Request):
    body = await _json_body(request)
    top_k = body.get("topK")
    if isinstance(top_k, (int, float)) and not isinstance(top_k, bool):
        top_k = min(max(int(top_k), 1), 20)
    else:
        top_k = 5
    try:
        return await ask(body.get("question"), top_k=top_k)
    except AskError as err:
        raise KarmaError(str(err), status=err.status) from err


# ── EXPERIENCE ───────────────────────────────────────────────────────────────


@router.get("/experience")
async def list_experience():
    db = get_db()
    cursor = (
        db[COLLECTIONS["experiences"]]
        .find()
        .sort([("startDate", -1), ("createdAt", -1)])
    )
    entries = [serialize_doc(d) async for d in cursor]

    kind_counts = {}
    skill_frequency = {}
    for e in entries:
        kind_counts[e.get("kind", "project")] = kind_counts.get(e.get("kind", "project"), 0) + 1
        for s in e.get("skills") or []:
            key = str(s).lower().strip()
            if key:
                skill_frequency[key] = skill_frequency.get(key, 0) + 1
    top_skills = [
        {"skill": skill, "count": count}
        for skill, count in sorted(skill_frequency.items(), key=lambda kv: kv[1], reverse=True)[:10]
    ]
    return {
        "experiences": entries,
        "analytics": {"total": len(entries), "kindCounts": kind_counts, "topSkills": top_skills},
    }


@router.post("/experience", status_code=201)
async def create_experience(request: Request):
    db = get_db()
    payload = await _json_body(request)
    if not payload.get("title") or not isinstance(payload.get("title"), str):
        raise KarmaError("title is required", status=400)
    if payload.get("kind") and payload["kind"] not in EXPERIENCE_KINDS:
        raise KarmaError("invalid kind", status=400)

    entry = {
        "title": payload["title"],
        "organization": payload.get("organization") or "",
        "kind": payload.get("kind") or "project",
        "startDate": payload.get("startDate"),
        "endDate": payload.get("endDate"),
        "ongoing": bool(payload.get("ongoing")),
        "description": payload.get("description") or "",
        "skills": payload.get("skills") if isinstance(payload.get("skills"), list) else [],
        "highlights": payload.get("highlights") if isinstance(payload.get("highlights"), list) else [],
        "outcome": payload.get("outcome") or "",
        "createdAt": now_utc(),
        "updatedAt": now_utc(),
    }
    result = await db[COLLECTIONS["experiences"]].insert_one(entry)
    entry["_id"] = result.inserted_id

    content_text = autopilot.render_experience_as_text(entry)
    doc = {
        "title": entry["title"],
        "content": content_text,
        "sourceType": "experience",
        "metadata": {"experienceId": str(entry["_id"]), "kind": entry["kind"]},
        "chunkCount": 0,
        "autonomouslyGenerated": False,
        "createdAt": now_utc(),
        "updatedAt": now_utc(),
    }
    doc_result = await db[COLLECTIONS["documents"]].insert_one(doc)
    chunks = await index_document(
        document_id=doc_result.inserted_id,
        text=content_text,
        source_title=entry["title"],
        source_type="experience",
    )
    await db[COLLECTIONS["documents"]].update_one(
        {"_id": doc_result.inserted_id}, {"$set": {"chunkCount": len(chunks)}}
    )
    return {
        "experience": serialize_doc(entry),
        "documentsCreated": 1,
        "chunksIndexed": len(chunks),
    }


# ── REPORTS / RUNS ───────────────────────────────────────────────────────────


@router.get("/reports")
async def list_reports(kind: str | None = None):
    db = get_db()
    query = {"kind": kind} if kind else {}
    cursor = db[COLLECTIONS["reports"]].find(query).sort("createdAt", -1).limit(50)
    return {"reports": [serialize_doc(r) async for r in cursor]}


@router.get("/runs")
async def list_runs():
    db = get_db()
    cursor = db[COLLECTIONS["agent_runs"]].find({}).sort("startedAt", -1).limit(30)
    return {"runs": [serialize_doc(r) async for r in cursor]}


# ── EVALUATION (Pandas/NumPy retrieval metrics) ─────────────────────────────


@router.get("/evaluation")
async def run_evaluation(top_k: int = 3):
    from ..services.rag_index import get_corpus

    corpus = await get_corpus()
    experiences = [
        d async for d in get_db()[COLLECTIONS["experiences"]].find().sort([("startDate", -1)])
    ]
    profile = await get_db()[COLLECTIONS["profiles"]].find_one({})
    questions = autopilot._build_probes(experiences, profile)
    result = evaluate_probes(corpus, questions, top_k=min(max(top_k, 1), 10))
    return {**result, "corpusSize": len(corpus)}


# ── AUTOPILOT CONTROL ────────────────────────────────────────────────────────


@router.post("/agent/run")
async def agent_run(request: Request):
    body = await _json_body(request)
    if body.get("seed") is not False:
        await ensure_seeded()
    run = await autopilot.run_cycle(trigger="manual")
    return {"run": serialize_doc(run)}


@router.post("/agent/autopilot/start")
async def autopilot_start(request: Request):
    import os

    body = await _json_body(request)
    cron_expr = body.get("cron") or os.environ.get("KARMA_AUTOPILOT_CRON") or "*/15 * * * *"
    try:
        started = autopilot.scheduler.start_scheduled(cron_expr)
    except autopilot.CronError as err:
        return JSONResponse(status_code=400, content={"error": str(err)})
    return {
        "started": started,
        "cron": cron_expr,
        "message": "Autopilot scheduled." if started else "Autopilot already scheduled.",
    }


@router.post("/agent/autopilot/stop")
async def autopilot_stop():
    stopped = autopilot.scheduler.stop_scheduled()
    return {"stopped": stopped, "message": "Autopilot stopped." if stopped else "Autopilot was not scheduled."}


@router.get("/agent/status")
async def agent_status():
    return {
        "scheduled": autopilot.scheduler.is_scheduled(),
        "running": autopilot.scheduler.is_running(),
    }
