"""Vercel serverless entrypoint for the KARMA FastAPI backend.

Vercel does not run ASGI lifespan events, so the runtime bootstrap
(MongoDB connect with in-memory fallback + baseline seeding) is executed
lazily once on the first request via a middleware instead of the lifespan.
"""

import os

os.environ.setdefault("KARMA_BOOTSTRAP", "0")  # lifespan bootstrap off; middleware handles it

from app.main import _bootstrap_runtime, create_app  # noqa: E402

app = create_app()

_booted = False


@app.middleware("http")
async def _bootstrap_once(request, call_next):
    global _booted
    if not _booted:
        import asyncio

        try:
            await asyncio.wait_for(_bootstrap_runtime(), timeout=25)
        except Exception as exc:  # bootstrap failure must not 500 every route
            print(f"[karma] serverless bootstrap warning: {exc}")
        _booted = True
    return await call_next(request)
