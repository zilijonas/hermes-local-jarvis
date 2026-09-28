"""Unit tests for the two-brain mediator (SPEC §Brains): think-tag stripping,
per-turn brain fallback, deep_answer, and report_task -- all with mocked httpx
transports, no real network or model."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from jarvisd.mediator import loop as loop_mod
from jarvisd.mediator.loop import Mediator, ThinkStripper, _read_env_key, opencode_go_configured


@pytest.fixture(autouse=True)
def _no_real_env_file(tmp_path, monkeypatch):
    """This box has a REAL OPENCODE_GO_API_KEY in ~/.hermes/.env -- tests that
    exercise the "no key configured" path must not silently pick that up."""
    monkeypatch.setattr(loop_mod, "_DEFAULT_ENV_FILE", str(tmp_path / "no-such.env"))
    monkeypatch.delenv("OPENCODE_GO_API_KEY", raising=False)


def _sse(*chunks: dict) -> bytes:
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks)
    return (body + "data: [DONE]\n\n").encode()


# ---------------------------------------------------------------------------
# ThinkStripper
# ---------------------------------------------------------------------------


def test_think_stripper_strips_full_span_in_one_chunk():
    s = ThinkStripper()
    out = s.feed("<think>the user wants X</think>Hello there.") + s.flush()
    assert out == "Hello there."


def test_think_stripper_handles_span_split_across_chunks():
    s = ThinkStripper()
    out = ""
    for piece in ("<thi", "nk>reason", "ing here</th", "ink>Hi there."):
        out += s.feed(piece)
    out += s.flush()
    assert out == "Hi there."


def test_think_stripper_unterminated_leading_span_yields_nothing():
    # Truncated by max_tokens -- pure reasoning, must never be spoken.
    s = ThinkStripper()
    out = s.feed("<think>this never closes because the budget ran out")
    out += s.flush()
    assert out == ""


def test_think_stripper_passthrough_when_no_tag_present():
    s = ThinkStripper()
    out = s.feed("Just plain speech, nothing to strip.") + s.flush()
    assert out == "Just plain speech, nothing to strip."


def test_think_stripper_prose_before_and_after_think_span():
    s = ThinkStripper()
    out = s.feed("Sure. <think>hmm let me think</think> Here you go.") + s.flush()
    assert out == "Sure.  Here you go."


# ---------------------------------------------------------------------------
# _read_env_key / opencode_go_configured
# ---------------------------------------------------------------------------


def test_read_env_key_prefers_process_env(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_API_KEY", "from-env")
    assert _read_env_key("OPENCODE_GO_API_KEY") == "from-env"


def test_read_env_key_falls_back_to_env_file(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENCODE_GO_API_KEY", raising=False)
    env_file = tmp_path / "fake.env"
    env_file.write_text('OTHER=1\nOPENCODE_GO_API_KEY="from-file"\n')
    assert _read_env_key("OPENCODE_GO_API_KEY", path=str(env_file)) == "from-file"


def test_read_env_key_missing_returns_none(tmp_path, monkeypatch):
    monkeypatch.delenv("OPENCODE_GO_API_KEY", raising=False)
    assert _read_env_key("OPENCODE_GO_API_KEY", path=str(tmp_path / "nope.env")) is None


def test_opencode_go_configured_reflects_env(monkeypatch):
    monkeypatch.delenv("OPENCODE_GO_API_KEY", raising=False)
    assert opencode_go_configured() is False
    monkeypatch.setenv("OPENCODE_GO_API_KEY", "x")
    assert opencode_go_configured() is True


# ---------------------------------------------------------------------------
# Brain selection + fallback
# ---------------------------------------------------------------------------


def _native_local_mediator(handler, brain="local", cloud_url="https://opencode.ai/zen/go/v1/chat/completions"):
    m = Mediator(ollama_url="http://127.0.0.1:8090", model="gpt-oss-20b-mxfp4",
                 native=True, brain=brain, cloud_url=cloud_url)
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return m


@pytest.mark.asyncio
async def test_default_brain_is_local_and_stays_on_it_when_it_works():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "127.0.0.1:8090" in str(request.url)
        return httpx.Response(200, content=_sse({"choices": [{"delta": {"content": "Hi."}}]}))

    m = _native_local_mediator(handler)
    out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}], asyncio.Event())])
    assert out == "Hi."


@pytest.mark.asyncio
async def test_brain_falls_back_from_local_to_cloud_on_connect_error(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_API_KEY", "test-key")
    seen_hosts = []

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        seen_hosts.append(url)
        if "127.0.0.1:8090" in url:
            raise httpx.ConnectError("connection refused", request=request)
        assert "x-opencode-session" in request.headers
        assert request.headers["user-agent"] == "jarvisd/1.0"
        return httpx.Response(200, content=_sse({"choices": [{"delta": {"content": "Hi from cloud."}}]}))

    m = _native_local_mediator(handler, brain="local")
    out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}], asyncio.Event())])
    assert out == "Hi from cloud."
    assert any("127.0.0.1:8090" in h for h in seen_hosts)
    assert any("opencode.ai" in h for h in seen_hosts)


@pytest.mark.asyncio
async def test_brain_falls_back_from_cloud_to_local_on_http_error(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "opencode.ai" in url:
            return httpx.Response(500, content=b"server error")
        return httpx.Response(200, content=_sse({"choices": [{"delta": {"content": "Hi from local."}}]}))

    m = _native_local_mediator(handler, brain="cloud")
    out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}], asyncio.Event())])
    assert out == "Hi from local."


@pytest.mark.asyncio
async def test_brain_fallback_gives_up_cleanly_when_both_fail(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    m = _native_local_mediator(handler, brain="local")
    out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}], asyncio.Event())])
    assert out == ""  # never raises -- caller's existing empty-reply retry takes over


@pytest.mark.asyncio
async def test_cloud_brain_missing_key_falls_back_to_local(monkeypatch):
    monkeypatch.delenv("OPENCODE_GO_API_KEY", raising=False)

    def handler(request: httpx.Request) -> httpx.Response:
        assert "127.0.0.1:8090" in str(request.url)  # cloud must never be attempted without a key
        return httpx.Response(200, content=_sse({"choices": [{"delta": {"content": "Local answer."}}]}))

    m = _native_local_mediator(handler, brain="cloud")
    out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}], asyncio.Event())])
    assert out == "Local answer."


@pytest.mark.asyncio
async def test_cloud_brain_strips_think_tags_from_stream():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_sse(
            {"choices": [{"delta": {"content": "<think>plan"}}]},
            {"choices": [{"delta": {"content": "ning here</think>The weather is mild."}}]}))

    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x", native=True, brain="cloud")
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    import os
    os.environ["OPENCODE_GO_API_KEY"] = "test-key"
    try:
        out = "".join([d async for d in m._stream([{"role": "user", "content": "hi"}], asyncio.Event())])
    finally:
        os.environ.pop("OPENCODE_GO_API_KEY", None)
    assert "<think>" not in out and "plan" not in out
    assert out == "The weather is mild."


def test_set_brain_validates_and_switches():
    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x")
    assert m.brain == "local"
    result = m.set_brain("cloud")
    assert result == {"ok": True, "brain": "cloud"}
    assert m.brain == "cloud"
    bad = m.set_brain("nonsense")
    assert bad["ok"] is False
    assert m.brain == "cloud"  # unchanged on a bad value


def test_reset_generates_a_new_session_id():
    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x")
    first = m.session_id
    m.reset()
    assert m.session_id != first
    assert m.session_id.startswith("jarvis-")


# ---------------------------------------------------------------------------
# deep_answer
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_deep_answer_uses_deep_model_no_tools_and_strips_think(monkeypatch):
    monkeypatch.setenv("OPENCODE_GO_API_KEY", "test-key")
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        captured["body"] = body
        captured["headers"] = request.headers
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "<think>work</think>Paris is the capital of France."}}]})

    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x", deep_model="minimax-m3")
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await m.deep_answer("What is the capital of France?")
    assert result == {"answer": "Paris is the capital of France."}
    assert captured["body"]["model"] == "minimax-m3"
    assert "tools" not in captured["body"]
    assert captured["headers"]["x-opencode-session"] == m.session_id


@pytest.mark.asyncio
async def test_deep_answer_empty_question_is_an_error_without_a_network_call():
    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x")

    async def _boom(*a, **k):
        raise AssertionError("must not call the network for an empty question")
    m._client.post = _boom  # type: ignore[assignment]
    result = await m.deep_answer("   ")
    assert "error" in result


@pytest.mark.asyncio
async def test_deep_answer_never_raises_on_failure(monkeypatch):
    monkeypatch.delenv("OPENCODE_GO_API_KEY", raising=False)
    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x")
    result = await m.deep_answer("anything")
    assert "error" in result


# ---------------------------------------------------------------------------
# report_task
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_report_task_uses_active_brain_and_returns_clean_text():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "The disk check finished: forty percent free."}}]})

    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x", native=True, brain="local")
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    text = await m.report_task({"status": "done", "goal": "check disk space",
                                "result_summary": "40% free"})
    assert text == "The disk check finished: forty percent free."


@pytest.mark.asyncio
async def test_report_task_falls_back_to_sanitized_template_on_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x", native=True, brain="local")
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    text = await m.report_task({"status": "failed", "goal": "back up the database",
                                "result_summary": "disk full"})
    assert "back up the database" in text.lower()
    assert "failed" in text.lower()
    assert "disk full" in text.lower()


@pytest.mark.asyncio
async def test_report_task_never_raises_when_task_is_sparse():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    m = Mediator(ollama_url="http://127.0.0.1:8090", model="x", native=True, brain="local")
    m._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    text = await m.report_task({"status": "done"})
    assert isinstance(text, str) and text


# ---------------------------------------------------------------------------
# /brains, /backends HTTP surface (app.py routes touched by this feature)
# ---------------------------------------------------------------------------


def _make_test_app(tmp_path):
    from jarvisd import config as config_mod
    from jarvisd.app import create_app

    cfg = config_mod.load_config(tmp_path / "jarvisd.toml")
    cfg.data["paths"]["hermes_home"] = str(tmp_path / "hermes_home")
    cfg.data["paths"]["worker_home"] = str(tmp_path / "worker_home")
    return create_app(config=cfg)


def test_get_brains_without_pipeline_reports_config_default(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("JARVISD_NO_PIPELINE", "1")
    monkeypatch.setattr(loop_mod, "opencode_go_configured", lambda: False)
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        r = client.get("/brains")
        assert r.status_code == 200
        body = r.json()
        assert body["active"] == "cloud"
        ids = {b["id"] for b in body["brains"]}
        assert ids == {"local", "cloud"}
        cloud = next(b for b in body["brains"] if b["id"] == "cloud")
        assert cloud["available"] is False


def test_post_brains_without_mediator_is_501(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("JARVISD_NO_PIPELINE", "1")
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        r = client.post("/brains", json={"brain": "cloud"})
        assert r.status_code == 501


def test_get_backends_includes_labels_and_defaults_to_cloud(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setenv("JARVISD_NO_PIPELINE", "1")
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        r = client.get("/backends")
        assert r.status_code == 200
        body = r.json()
        assert body["active"] == "cloud"
        assert body["labels"]["cloud"] == "codecloud"
        assert body["labels"]["local"] == "Local gpt-oss"
        assert set(body["backends"]) == {"local", "cloud", "codex", "claude"}


# ---------------------------------------------------------------------------
# config: new list-valued keys must survive a save()/reload() round trip
# ---------------------------------------------------------------------------


def test_config_worker_and_brain_defaults_and_list_roundtrip(tmp_path):
    from jarvisd import config as config_mod

    cfg = config_mod.load_config(tmp_path / "jarvisd.toml")
    assert cfg.data["worker"]["backend"] == "cloud"
    assert cfg.data["worker"]["cloud_toolsets"] == []
    assert cfg.data["worker"]["timeout_s"] == 900
    assert cfg.data["brain"]["active"] == "cloud"
    assert cfg.data["brain"]["cloud_model"] == "deepseek-v4.1-flash"
    assert cfg.path_for("worker_home") == Path("~/ai/state/jarvis-voice/hermes-home").expanduser()

    # Any save() re-dumps the WHOLE config, including the cloud_toolsets list --
    # _toml_scalar must know how to render a list or this corrupts the file.
    cfg.save({"tts": {"voice": "af_bella"}, "worker": {"cloud_toolsets": ["web", "file"]}})
    reloaded = config_mod.load_config(tmp_path / "jarvisd.toml")
    assert reloaded.data["worker"]["cloud_toolsets"] == cfg.data["worker"]["cloud_toolsets"]
    assert reloaded.data["tts"]["voice"] == "af_bella"
