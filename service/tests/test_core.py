"""Core skeleton tests: config, db, bus, metrics, HTTP app, websocket."""

from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from jarvisd import config as config_mod
from jarvisd import metrics as metrics_mod
from jarvisd.app import create_app
from jarvisd.bus import EventBus
from jarvisd.db import Database

# ---------------------------------------------------------------- config


def test_config_defaults_when_file_missing(tmp_path):
    cfg = config_mod.load_config(tmp_path / "missing.toml")
    assert cfg.data["server"]["port"] == 9140
    assert cfg.data["tts"]["voice"] == "am_michael"
    assert cfg.data["ollama"]["mediator"] == "gemma4:e4b-it-qat"
    assert cfg.path_for("hermes_home") == Path("~/.hermes/profiles/jarvis-voice").expanduser()


def test_config_save_and_reload_roundtrip(tmp_path):
    cfg_path = tmp_path / "jarvisd.toml"
    cfg = config_mod.load_config(cfg_path)

    cfg.save({"tts": {"voice": "af_bella"}, "budgets": {"context_card_tokens": 800}})
    assert cfg.data["tts"]["voice"] == "af_bella"
    assert cfg.data["budgets"]["context_card_tokens"] == 800
    assert cfg.data["tts"]["engine"] == "kokoro"  # unrelated defaults survive the patch

    reloaded = config_mod.load_config(cfg_path)
    assert reloaded.data["tts"]["voice"] == "af_bella"
    assert reloaded.data["budgets"]["context_card_tokens"] == 800
    assert reloaded.data["server"]["port"] == 9140  # untouched section preserved


def test_config_env_port_override(tmp_path, monkeypatch):
    monkeypatch.setenv("JARVISD_PORT", "9999")
    cfg = config_mod.load_config(tmp_path / "missing.toml")
    assert cfg.data["server"]["port"] == 9999


def test_config_attribute_style_section_access(tmp_path):
    # The voice pipeline (jarvisd/pipeline.py) reads config as cfg.vad.aggressiveness etc.,
    # not just cfg.data["vad"]["aggressiveness"] — both must work against the same live data.
    cfg = config_mod.load_config(tmp_path / "missing.toml")
    assert cfg.vad.aggressiveness == cfg.data["vad"]["aggressiveness"] == 2
    assert cfg.tts.voice == "am_michael"
    assert cfg.budgets.context_card_tokens == 600
    with pytest.raises(AttributeError):
        cfg.no_such_section


# ---------------------------------------------------------------- db


def test_db_schema_and_task_dao_roundtrip(tmp_path):
    db = Database(tmp_path / "jarvis.db")
    task = db.create_task(kind="granite", goal="do a thing", context="ctx", toolsets="fs,web")
    assert task["status"] == "queued"
    assert task["events"] == []

    db.add_task_event(task["id"], "started", {"note": "kicked off"})
    updated = db.update_task(task["id"], status="running", started=time.time())
    assert updated["status"] == "running"
    assert len(updated["events"]) == 1
    assert updated["events"][0]["payload"]["note"] == "kicked off"

    done = db.update_task(task["id"], status="done", validation={"exit_ok": True}, usage={"tokens": 42})
    assert done["validation"] == {"exit_ok": True}
    assert done["usage"] == {"tokens": 42}

    listed = db.list_tasks(status="done")
    assert any(t["id"] == task["id"] for t in listed)
    assert db.get_task("does-not-exist") is None


def test_db_create_task_accepts_caller_supplied_id_and_metadata(tmp_path):
    # workers.manager.WorkerManager.delegate() mints its own task_id up front (to publish
    # bus events before the row exists) and passes a metadata dict for capability feedback.
    db = Database(tmp_path / "jarvis.db")
    task = db.create_task("abc123", kind="granite", goal="g", metadata={"capability_id": "cap.x"})
    assert task["id"] == "abc123"
    assert task["metadata"] == {"capability_id": "cap.x"}

    updated = db.update_task("abc123", metadata={"capability_id": "cap.y"})
    assert updated["metadata"] == {"capability_id": "cap.y"}


def test_db_add_turn_accepts_caller_supplied_turn_id(tmp_path):
    # jarvisd/pipeline.py mints turn_id up front and publishes turn_events under it well
    # before the turn completes; add_turn must accept that same id, not generate its own.
    db = Database(tmp_path / "jarvis.db")
    db.add_turn_event("t123", "state", {"value": "thinking"})  # events arrive first
    turn = db.add_turn("t123", transcript="hi", reply="hello", ms_first_token=80.0)
    assert turn["id"] == "t123"

    traces = db.recent_traces(limit=5)
    assert traces[0]["id"] == "t123"
    assert traces[0]["events"][0]["type"] == "state"


def test_db_turns_and_traces(tmp_path):
    db = Database(tmp_path / "jarvis.db")
    turn = db.add_turn(transcript="hello", reply="hi", ms_stt=120.0)
    db.add_turn_event(turn["id"], "state", {"value": "thinking"})

    traces = db.recent_traces(limit=5)
    assert traces[0]["id"] == turn["id"]
    assert traces[0]["events"][0]["type"] == "state"
    assert traces[0]["events"][0]["payload"]["value"] == "thinking"


# ---------------------------------------------------------------- bus


def test_bus_fanout_and_drop_oldest():
    bus = EventBus(maxsize=2)
    q1 = bus.subscribe()
    q2 = bus.subscribe()

    bus.publish({"t": "a"})
    bus.publish({"t": "b"})
    bus.publish({"t": "c"})  # queue of size 2 is full -> oldest ("a") is dropped

    assert q1.qsize() == 2
    assert q1.get_nowait()["t"] == "b"
    assert q1.get_nowait()["t"] == "c"

    size_before_unsubscribe = q2.qsize()
    bus.unsubscribe(q2)
    bus.publish({"t": "d"})
    assert q2.qsize() == size_before_unsubscribe  # unsubscribed: no longer receives new events


def test_bus_persists_task_and_turn_events(tmp_path):
    db = Database(tmp_path / "jarvis.db")
    task = db.create_task(kind="codex", goal="g")
    bus = EventBus(db=db)
    bus.subscribe()

    bus.publish({"t": "task.update", "id": task["id"], "status": "running"})
    bus.publish({"t": "mediator.delta", "turn_id": "turn-1", "text": "hi"})

    refreshed = db.get_task(task["id"])
    assert any(e["type"] == "task.update" for e in refreshed["events"])

    row = db.get_conn().execute(
        "SELECT * FROM turn_events WHERE turn_id = ?", ("turn-1",)
    ).fetchone()
    assert row is not None


# ---------------------------------------------------------------- metrics


def test_metrics_percentiles_and_counters():
    metrics_mod.metrics.reset()
    for ms in [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]:
        metrics_mod.metrics.record("stt", ms)
    metrics_mod.metrics.inc("turns")
    metrics_mod.metrics.inc("turns")

    snap = metrics_mod.metrics.snapshot()
    assert snap["counters"]["turns"] == 2
    assert snap["histograms"]["stt"]["count"] == 10
    assert snap["histograms"]["stt"]["p50"] in (50, 60)
    assert snap["histograms"]["stt"]["p95"] >= 90
    assert "free_gb" in snap["ram"]


# ---------------------------------------------------------------- HTTP app


def _make_test_app(tmp_path):
    cfg = config_mod.load_config(tmp_path / "jarvisd.toml")
    cfg.data["paths"]["hermes_home"] = str(tmp_path / "hermes_home")
    return create_app(config=cfg)


def test_health_config_tasks_endpoints(tmp_path):
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        r = client.get("/health")
        assert r.status_code == 200
        body = r.json()
        assert body["components"]["stt"] == {"ok": False, "detail": "not initialized"}
        assert "ram" in body and "free_gb" in body["ram"]
        assert body["version"] == "0.1.0"

        r = client.get("/config")
        assert r.status_code == 200
        assert r.json()["tts"]["voice"] == "am_michael"

        r = client.post("/config", json={"tts": {"voice": "af_bella"}})
        assert r.status_code == 200
        assert r.json()["tts"]["voice"] == "af_bella"
        # persisted to disk
        assert "af_bella" in (tmp_path / "jarvisd.toml").read_text()

        r = client.get("/tasks")
        assert r.status_code == 200
        assert r.json()["tasks"] == []

        r = client.get("/tasks/does-not-exist")
        assert r.status_code == 404

        r = client.post("/say", json={"text": "hi", "interrupt": False})
        assert r.status_code == 501

        r = client.post("/converse", json={"text": "hi"})
        assert r.status_code == 501

        r = client.get("/metrics")
        assert r.status_code == 200
        assert "histograms" in r.json()

        r = client.get("/traces")
        assert r.status_code == 200
        assert r.json()["traces"] == []


def test_task_lifecycle_via_db_then_http(tmp_path):
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        db = app.state.db
        task = db.create_task(kind="granite", goal="say hi")

        r = client.get(f"/tasks/{task['id']}")
        assert r.status_code == 200
        assert r.json()["goal"] == "say hi"

        r = client.get("/tasks", params={"status": "queued"})
        assert any(t["id"] == task["id"] for t in r.json()["tasks"])


# ---------------------------------------------------------------- websocket


def test_ws_ping_and_bus_event_forward(tmp_path):
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"t": "ping"})
            assert ws.receive_json() == {"t": "pong"}

            app.state.bus.publish({"t": "state", "value": "idle"})
            event = ws.receive_json()
            assert event["t"] == "state"
            assert event["value"] == "idle"


def test_ws_no_pipeline_sends_error_once(tmp_path):
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            ws.send_json({"t": "turn.text", "text": "hello"})
            event = ws.receive_json()
            assert event["t"] == "error"
            assert event["recoverable"] is True


def test_ws_forwards_publish_binary_as_header_then_bytes(tmp_path):
    # jarvisd/pipeline.py streams TTS audio via bus.publish_binary(header, pcm_bytes) so all
    # connected UI clients get it, not just one — verify the ws forwarder speaks that framing.
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            app.state.bus.publish_binary({"t": "tts.chunk_hdr", "seq": 1, "samples": 4}, b"\x00\x01\x02\x03")
            header = ws.receive_json()
            assert header["t"] == "tts.chunk_hdr"
            assert header["samples"] == 4
            raw = ws.receive_bytes()
            assert raw == b"\x00\x01\x02\x03"


def test_ws_multiple_clients_both_get_events(tmp_path):
    app = _make_test_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws1, client.websocket_connect("/ws") as ws2:
            app.state.bus.publish({"t": "state", "value": "listening"})
            assert ws1.receive_json()["value"] == "listening"
            assert ws2.receive_json()["value"] == "listening"
