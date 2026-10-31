"""Async MongoDB connection layer.

Uses Motor against MONGODB_URI when reachable; falls back to an in-process
mongomock-motor database (demo mode) so the full stack runs with zero local
installs. Tests inject an in-memory database directly via set_db().

Motor clients are event-loop bound. Long-running hosts (uvicorn) use a single
loop, but serverless platforms may rotate loops between warm invocations, so
real-Mongo clients are cached per loop and re-created lazily when needed.
"""

import asyncio
import os

from motor.motor_asyncio import AsyncIOMotorClient

_current_uri: str | None = None
_mode: str | None = None  # None | "mongo" | "memory"
_clients: dict = {}  # loop id -> AsyncIOMotorClient
_memory_db = None


def _loop_client() -> AsyncIOMotorClient:
    loop = asyncio.get_running_loop()
    key = id(loop)
    client = _clients.get(key)
    if client is None:
        timeout = int(os.environ.get("KARMA_DB_TIMEOUT_MS", "5000"))
        client = AsyncIOMotorClient(_current_uri, serverSelectionTimeoutMS=timeout)
        _clients[key] = client
    return client


async def connect_db(uri: str):
    """Connect to a real MongoDB and ping it. Raises on failure."""
    global _current_uri, _mode, _memory_db
    _current_uri = uri
    client = _loop_client()
    await client.admin.command("ping")
    _memory_db = None
    _mode = "mongo"
    return get_db()


async def use_in_memory_db():
    """Swap to an in-memory Mongo (mongomock-motor) — demo/test mode."""
    global _mode, _memory_db
    from mongomock_motor import AsyncMongoMockClient

    client = AsyncMongoMockClient()
    _memory_db = client.get_database("karma")
    _mode = "memory"
    return _memory_db


def set_db(db) -> None:
    """Directly inject a database handle (used by the test suite)."""
    global _mode, _memory_db
    _memory_db = db
    _mode = "memory"


def get_db():
    if _mode == "memory":
        return _memory_db
    if _current_uri is None:
        raise RuntimeError("Database not connected")
    return _loop_client().get_default_database("karma")


def is_in_memory() -> bool:
    return _mode == "memory"


async def disconnect_db() -> None:
    global _current_uri, _mode, _memory_db
    for client in _clients.values():
        client.close()
    _clients.clear()
    _current_uri = None
    _memory_db = None
    _mode = None


async def is_db_reachable() -> bool:
    if _mode is None:
        return False
    if _mode == "memory":
        return True
    try:
        await _loop_client().admin.command("ping")
        return True
    except Exception:
        return False


def db_state_label() -> str:
    if _mode is None:
        return "disconnected"
    return "in-memory" if _mode == "memory" else "connected"
