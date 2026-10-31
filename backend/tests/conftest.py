"""Shared fixtures: fresh in-memory MongoDB per test module, clean caches."""

import asyncio
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

# Never let a developer's real LLM keys leak into the test run.
for _key in ("OPENAI_API_KEY", "GEMINI_API_KEY", "REDIS_URL", "KARMA_BOOTSTRAP"):
    os.environ.pop(_key, None)

import pytest  # noqa: E402


def reset_state() -> None:
    from app import db as db_module
    from app.agent import autopilot
    from app.rag import retriever
    from app.services import cache as cache_module
    from app.services import rag_index, vector_store
    from app.services import llm_client

    db_module._client = None
    db_module._db = None
    db_module._in_memory = True
    rag_index.corpus_version = 0
    rag_index.reset_corpus_cache()
    retriever.reset_fitted_cache()
    vector_store._store["client"] = None
    vector_store._store["corpus"] = None
    vector_store._store["engine"] = None
    cache_module.reset_cache_for_tests()
    autopilot.scheduler.stop_scheduled()
    llm_client.configure(openai_api_key=None, gemini_api_key=None)


reset_state()


@pytest.fixture(scope="module")
def fresh_state():
    reset_state()
    yield
    reset_state()


@pytest.fixture(scope="module")
def db(fresh_state):
    from app import db as db_module
    from mongomock_motor import AsyncMongoMockClient

    client = AsyncMongoMockClient()
    db_module.set_db(client.get_database("karma"))
    return db_module.get_db()


@pytest.fixture(scope="module")
def client(db):
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@pytest.fixture(scope="module")
def seeded_client(client):
    from app.services.bootstrap import ensure_seeded

    asyncio.run(ensure_seeded())
    return client
