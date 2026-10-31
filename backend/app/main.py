"""FastAPI app factory (kept separate from the listener for testability).

When KARMA_BOOTSTRAP=1 (set by server.py), the lifespan connects MongoDB —
falling back to an in-memory demo database when unreachable — seeds the
baseline corpus and optionally starts the APScheduler autopilot.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .routes.api import router
from .routes.errors import KarmaError

logger = logging.getLogger("karma.api")

FRONTEND_URL = "https://karma-dashboard-boradeomkar36-gmailcoms-projects.vercel.app/"


def _make_lifespan():
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if os.environ.get("KARMA_BOOTSTRAP") == "1":
            await _bootstrap_runtime()
        yield
        from .agent import autopilot
        from .db import disconnect_db

        autopilot.scheduler.stop_scheduled()
        await disconnect_db()

    return lifespan


async def _bootstrap_runtime() -> None:
    from .agent import autopilot
    from .db import connect_db, use_in_memory_db
    from .services import llm_client
    from .services.bootstrap import ensure_seeded

    llm_client.configure_from_env()
    if llm_client.is_configured():
        print(
            f"[karma] LLM uplift enabled (provider: {llm_client.active_provider()}, "
            f"model: {llm_client.provider_model()})"
        )

    connected = False
    uri = os.environ.get("MONGODB_URI") or "mongodb://127.0.0.1:27017/karma"
    if os.environ.get("KARMA_IN_MEMORY_DB") != "1":
        try:
            await connect_db(uri)
            connected = True
            print(f"[karma] database connected ({uri})")
        except Exception as err:
            print(
                f"[karma] could not reach MongoDB at {uri} ({err}). Falling back to an "
                "in-memory demo database (data lives for this process only)."
            )
    if not connected:
        await use_in_memory_db()
        print("[karma] in-memory demo database ready")

    seeding = await ensure_seeded()
    if seeding.get("seeded"):
        print(
            f"[karma] seeded baseline corpus ({seeding['documents']} documents, "
            f"{seeding['chunks']} chunks)"
        )

    if os.environ.get("KARMA_AUTOPILOT_ENABLED", "").lower() in ("1", "true"):
        cron_expr = os.environ.get("KARMA_AUTOPILOT_CRON") or "*/15 * * * *"
        try:
            if autopilot.scheduler.start_scheduled(cron_expr):
                print(f"[karma] autopilot scheduled (cron: {cron_expr})")
        except Exception as err:
            print(f"[karma] autopilot scheduling failed: {err}")


def create_app() -> FastAPI:
    app = FastAPI(title="KARMA API", version="2.0.0", lifespan=_make_lifespan())

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)

    @app.get("/")
    async def landing():
        return {
            "service": "KARMA API",
            "status": "running",
            "frontend": FRONTEND_URL,
            "health": "/api/health",
            "keyRoutes": [
                "/api/profile", "/api/documents", "/api/ask", "/api/experience",
                "/api/reports", "/api/runs", "/api/evaluation", "/api/agent/run",
            ],
        }

    @app.exception_handler(KarmaError)
    async def karma_error_handler(request: Request, exc: KarmaError):
        logger.error("[karma][api] error: %s", exc)
        return JSONResponse(status_code=exc.status, content={"error": str(exc)})

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException):
        path = request.url.path
        # Express parity: any unmatched method+path under /api is a JSON 404.
        if path.startswith("/api") and exc.status_code in (404, 405):
            return JSONResponse(
                status_code=404,
                content={
                    "error": f"No route: {request.method} {path}",
                    "hint": "See / for available routes",
                },
            )
        if exc.status_code == 404:
            return JSONResponse(status_code=404, content={"error": f"Not found: {request.method} {path}"})
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        logger.exception("[karma][api] unhandled error: %s", exc)
        return JSONResponse(status_code=500, content={"error": "Internal server error"})

    return app
