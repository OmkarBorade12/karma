"""Boot-time seeding: on first run with an empty DB, KARMA installs the
baseline experience profile so the autopilot has something to reason over.
Idempotent.
"""

from ..agent.autopilot import render_experience_as_text
from ..data.seed_experience import SEED_EXPERIENCES, SEED_PROFILE
from ..db import get_db
from ..models import COLLECTIONS, now_utc
from .rag_index import index_document


async def ensure_seeded() -> dict:
    db = get_db()
    existing = await db[COLLECTIONS["documents"]].count_documents({})
    if existing > 0:
        return {"seeded": False, "reason": "already-populated"}

    if not await db[COLLECTIONS["profiles"]].count_documents({}):
        await db[COLLECTIONS["profiles"]].insert_one(
            {**SEED_PROFILE, "createdAt": now_utc(), "updatedAt": now_utc()}
        )

    chunk_total = 0
    docs_created = []
    for seed in SEED_EXPERIENCES:
        entry = {
            **seed,
            "startDate": None,
            "endDate": None,
            "ongoing": False,
            "outcome": "",
            "createdAt": now_utc(),
            "updatedAt": now_utc(),
        }
        exp_result = await db[COLLECTIONS["experiences"]].insert_one(entry)
        entry["_id"] = exp_result.inserted_id

        content = render_experience_as_text(entry)
        doc = {
            "title": seed["title"],
            "content": content,
            "sourceType": "experience",
            "metadata": {"experienceId": str(entry["_id"]), "kind": entry["kind"]},
            "chunkCount": 0,
            "autonomouslyGenerated": False,
            "createdAt": now_utc(),
            "updatedAt": now_utc(),
        }
        doc_result = await db[COLLECTIONS["documents"]].insert_one(doc)
        doc["_id"] = doc_result.inserted_id

        chunks = await index_document(
            document_id=doc["_id"], text=content, source_title=doc["title"], source_type="experience"
        )
        await db[COLLECTIONS["documents"]].update_one(
            {"_id": doc["_id"]}, {"$set": {"chunkCount": len(chunks)}}
        )
        chunk_total += len(chunks)
        docs_created.append(doc["title"])

    return {"seeded": True, "documents": len(docs_created), "chunks": chunk_total}
