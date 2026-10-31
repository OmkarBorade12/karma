"""Unit tests for the GPT-4o / Gemini LLM client."""

import pytest

from app.services import llm_client


@pytest.fixture(autouse=True)
def reset_llm_config():
    llm_client.configure(
        openai_api_key="",
        openai_base_url="https://api.openai.com/v1",
        openai_model="gpt-4o",
        gemini_api_key="",
        gemini_model="gemini-2.0-flash",
    )
    yield


def test_reports_unconfigured_without_key_and_configured_with_one():
    assert llm_client.is_configured() is False
    llm_client.configure(openai_api_key="sk-test")
    assert llm_client.is_configured() is True
    assert llm_client.get_config()["openai"]["apiKey"] == "<set>"  # never leaks the key


async def test_complete_rejects_when_not_configured():
    with pytest.raises(RuntimeError, match=r"not configured"):
        await llm_client.complete("sys", "user")


async def test_complete_posts_to_chat_completions_with_auth(monkeypatch):
    llm_client.configure(
        openai_api_key="sk-test",
        openai_base_url="https://llm.example.com/v1/",
        openai_model="my-model",
    )
    calls = {}

    async def fake_post(url, headers, payload, timeout_s):
        calls["url"] = url
        calls["headers"] = headers
        calls["payload"] = payload
        return {"choices": [{"message": {"content": "  The grounded answer.  "}}]}

    monkeypatch.setattr(llm_client, "_post_json", fake_post)

    text = await llm_client.complete("system prompt", "user prompt")
    assert "The grounded answer" in text
    assert calls["url"] == "https://llm.example.com/v1/chat/completions"  # trailing slash removed
    assert calls["headers"]["Authorization"] == "Bearer sk-test"
    assert calls["payload"]["model"] == "my-model"
    assert calls["payload"]["messages"] == [
        {"role": "system", "content": "system prompt"},
        {"role": "user", "content": "user prompt"},
    ]


async def test_complete_surfaces_api_errors(monkeypatch):
    llm_client.configure(openai_api_key="sk-test")

    async def fake_post(url, headers, payload, timeout_s):
        raise RuntimeError("LLM API error 503")

    monkeypatch.setattr(llm_client, "_post_json", fake_post)
    with pytest.raises(RuntimeError, match="LLM API error 503"):
        await llm_client.complete("s", "u")


async def test_complete_rejects_empty_response(monkeypatch):
    llm_client.configure(openai_api_key="sk-test")

    async def fake_post(url, headers, payload, timeout_s):
        return {"choices": []}

    monkeypatch.setattr(llm_client, "_post_json", fake_post)
    with pytest.raises(RuntimeError, match="LLM returned no content"):
        await llm_client.complete("s", "u")
