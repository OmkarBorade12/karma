"""LLM uplift client supporting GPT-4o (OpenAI / OpenAI-compatible) and Gemini.

Used for grounded answer synthesis and LLM reranking of retrieved candidates.
When no provider is configured the RAG engine runs fully-local extractive;
every LLM failure is non-fatal and falls back to the local pipeline.
"""

import json
import os
import re

import httpx

_config = {
    "openai": {"apiKey": None, "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o"},
    "gemini": {"apiKey": None, "model": "gemini-2.0-flash"},
}


def configure(
    openai_api_key=None,
    openai_base_url=None,
    openai_model=None,
    gemini_api_key=None,
    gemini_model=None,
) -> None:
    if openai_api_key is not None:
        _config["openai"]["apiKey"] = openai_api_key or None
    if openai_base_url:
        _config["openai"]["baseUrl"] = openai_base_url.rstrip("/")
    if openai_model:
        _config["openai"]["model"] = openai_model
    if gemini_api_key is not None:
        _config["gemini"]["apiKey"] = gemini_api_key or None
    if gemini_model:
        _config["gemini"]["model"] = gemini_model


def configure_from_env() -> None:
    configure(
        openai_api_key=os.environ.get("OPENAI_API_KEY"),
        openai_base_url=os.environ.get("OPENAI_BASE_URL"),
        openai_model=os.environ.get("OPENAI_MODEL"),
        gemini_api_key=os.environ.get("GEMINI_API_KEY"),
        gemini_model=os.environ.get("GEMINI_MODEL"),
    )


configure_from_env()


def is_configured() -> bool:
    return bool(_config["openai"]["apiKey"] or _config["gemini"]["apiKey"])


def active_provider() -> str | None:
    if _config["openai"]["apiKey"]:
        return "openai"
    if _config["gemini"]["apiKey"]:
        return "gemini"
    return None


def provider_model() -> str | None:
    provider = active_provider()
    if provider is None:
        return None
    return _config[provider]["model"]


def get_config() -> dict:
    return {
        "openai": {**_config["openai"], "apiKey": "<set>" if _config["openai"]["apiKey"] else None},
        "gemini": {**_config["gemini"], "apiKey": "<set>" if _config["gemini"]["apiKey"] else None},
        "active": active_provider(),
    }


async def _post_json(url, headers, payload, timeout_s: float) -> dict:
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"LLM API error {response.status_code}")
        return response.json()


async def complete(system_prompt, user_prompt, max_tokens: int = 700,
                   temperature: float = 0.3, timeout_s: float = 20.0) -> str:
    """One completion via the active provider (openai preferred, then gemini)."""
    provider = active_provider()
    if provider is None:
        raise RuntimeError("LLM not configured")

    if provider == "openai":
        cfg = _config["openai"]
        data = await _post_json(
            f"{cfg['baseUrl']}/chat/completions",
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {cfg['apiKey']}",
            },
            {
                "model": cfg["model"],
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": max_tokens,
                "temperature": temperature,
            },
            timeout_s,
        )
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            text = None
        if not text:
            raise RuntimeError("LLM returned no content")
        return text

    cfg = _config["gemini"]
    data = await _post_json(
        f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent",
        {"Content-Type": "application/json", "x-goog-api-key": cfg["apiKey"]},
        {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
        },
        timeout_s,
    )
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts)
    except (KeyError, IndexError, TypeError):
        text = None
    if not text:
        raise RuntimeError("LLM returned no content")
    return text


RERANK_SYSTEM_PROMPT = (
    "You are a retrieval reranking engine. You reorder retrieved context blocks "
    "by how well they answer the question. Respond with ONLY a JSON array of the "
    "block numbers in best-first order. Never invent block numbers."
)


async def rerank_with_llm(question: str, candidates: list) -> list | None:
    """LLM reranking of the fused candidate pool.

    candidates: [{text, ...}] — returns a reordered copy of the same dicts, or
    None when the LLM is unavailable/its output is unusable (caller falls back
    to the deterministic heuristic reranker).
    """
    if not candidates:
        return None
    numbered = "\n\n".join(
        f"[{i + 1}] {(c.get('text') or '')[:600]}" for i, c in enumerate(candidates)
    )
    prompt = (
        f"Question: {question}\n\n"
        f"Context blocks:\n{numbered}\n\n"
        "Return the block numbers as a JSON array, best match first "
        '(example: [3, 1, 2]).'
    )
    try:
        raw = await complete(RERANK_SYSTEM_PROMPT, prompt, max_tokens=100, temperature=0.0)
    except Exception:
        return None

    match = re.search(r"\[[\s\S]*?\]", raw)
    if not match:
        return None
    try:
        order = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(order, list):
        return None

    seen, valid_order = set(), []
    for value in order:
        if isinstance(value, bool) or not isinstance(value, int):
            continue
        if 1 <= value <= len(candidates) and value not in seen:
            seen.add(value)
            valid_order.append(value)
    if not valid_order:
        return None
    remaining = [i + 1 for i in range(len(candidates)) if (i + 1) not in seen]
    final_order = valid_order + remaining
    return [candidates[n - 1] for n in final_order]
