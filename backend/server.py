"""KARMA backend entrypoint.

Run with:  python server.py   (or: uvicorn app.main:create_app --factory --port 5001)

Runtime bootstrap (MongoDB connect with in-memory fallback, baseline seeding,
optional APScheduler autopilot) happens inside the app lifespan so the Motor
client binds to the serving event loop. server.py sets KARMA_BOOTSTRAP=1 to
enable it; the test suite creates the app without the flag.
"""

import os

from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    import uvicorn

    os.environ.setdefault("KARMA_BOOTSTRAP", "1")
    port = int(os.environ.get("PORT", "5001"))

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host="0.0.0.0",
        port=port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
