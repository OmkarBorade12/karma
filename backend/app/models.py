"""Mongo collections + document serialization (Mongoose parity helpers)."""

from datetime import datetime, timezone
from bson import ObjectId

COLLECTIONS = {
    "profiles": "profiles",
    "documents": "documents",
    "chunks": "chunks",
    "experiences": "experiences",
    "reports": "reports",
    "agent_runs": "agent_runs",
}

EXPERIENCE_KINDS = [
    "job", "internship", "project", "education",
    "certification", "open-source", "hackathon", "personal",
]
SOURCE_TYPES = ["resume", "project", "experience", "note", "certificate", "qa", "insight", "seed"]
REPORT_KINDS = [
    "skill-gap", "narrative", "interview-qa", "trajectory",
    "retrieval-quality", "weekly-summary",
]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def serialize(value):
    """Recursively convert ObjectIds/dates so docs are JSON-safe (Mongoose lean parity)."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    return value


def serialize_doc(doc) -> dict | None:
    if doc is None:
        return None
    out = serialize(dict(doc))
    if "_id" in out:
        out["_id"] = str(doc["_id"])
    return out


def maybe_object_id(value):
    """Parse a hex id, returning None when invalid (mirrors CastError → 404 handling)."""
    if not value or not ObjectId.is_valid(str(value)):
        return None
    return ObjectId(str(value))
