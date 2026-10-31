"""Cache layer: Redis when REDIS_URL is reachable, in-process fallback otherwise.

Used to cache RAG answers; cache keys are namespaced by corpus version so any
index write invalidates every cached answer automatically.
"""

import os
import time

_memory_store: dict = {}


class InMemoryCache:
    """Tiny TTL cache used when Redis is not configured/reachable."""

    def __init__(self):
        self._store = {}

    def _alive(self, key):
        entry = self._store.get(key)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at is not None and time.time() > expires_at:
            self._store.pop(key, None)
            return None
        return value

    def get(self, key):
        return self._alive(key)

    def set(self, key, value, ttl_seconds: int | None = 3600):
        self._store[key] = (value, time.time() + ttl_seconds if ttl_seconds else None)

    def delete_prefix(self, prefix: str) -> int:
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            self._store.pop(k, None)
        return len(keys)

    def clear(self) -> None:
        self._store.clear()


_fallback = InMemoryCache()
_redis = None
_redis_attempted = False


def _get_redis():
    global _redis, _redis_attempted
    if _redis_attempted:
        return _redis
    _redis_attempted = True
    url = os.environ.get("REDIS_URL")
    if not url:
        return None
    try:
        import redis.asyncio as aioredis

        _redis = aioredis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        _redis = None
    return _redis


def cache_namespace(corpus_version: int) -> str:
    return f"karma:v{corpus_version}"


async def cache_get(key: str):
    client = _get_redis()
    if client is not None:
        try:
            value = await client.get(key)
            if value is not None:
                import json

                return json.loads(value)
        except Exception:
            pass
    return _fallback.get(key)


async def cache_set(key: str, value, ttl_seconds: int | None = 3600) -> None:
    client = _get_redis()
    if client is not None:
        try:
            import json

            await client.set(key, json.dumps(value), ex=ttl_seconds)
            return
        except Exception:
            pass
    _fallback.set(key, value, ttl_seconds)


async def cache_clear_namespace(prefix: str) -> None:
    client = _get_redis()
    if client is not None:
        try:
            keys = []
            async for k in client.scan_iter(match=f"{prefix}*"):
                keys.append(k)
            if keys:
                await client.delete(*keys)
            return
        except Exception:
            pass
    _fallback.delete_prefix(prefix)


def reset_cache_for_tests() -> None:
    global _redis, _redis_attempted
    _redis = None
    _redis_attempted = False
    _fallback.clear()
