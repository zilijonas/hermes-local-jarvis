"""jarvisd — FastAPI app + uvicorn entrypoint (SPEC §HTTP API)."""

from __future__ import annotations

import asyncio
import importlib
import inspect
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from . import __version__, metrics as metrics_mod
from .bus import EventBus
from .config import JarvisConfig, load_config
from .db import Database
from .logging_setup import setup as setup_logging
from .ws import router as ws_router

_HEALTH_TIMEOUT_S = 1.0


def _try_import_attr(module_path: str, attr: str):
    """Best-effort import used for modules other agents own (memory/caps/workers). Returns
    None (never raises) if the module or attribute doesn't exist yet — callers turn that into
    a 501 so the API surface is stable even while those pieces are still being built.
    """
    try:
        module = importlib.import_module(module_path)
    except ImportError:
        return None
    return getattr(module, attr, None)


async def _invoke(fn, *args: Any, **kwargs: Any) -> Any:
    """Call fn correctly whether it's `async def` (awaited on the loop) or a plain sync
    callable (offloaded to a thread — several of these cross-module hooks do blocking I/O,
    e.g. CapabilityRouter.search's httpx.post to Ollama).
    """
    if inspect.iscoroutinefunction(fn):
        return await fn(*args, **kwargs)
    return await run_in_threadpool(fn, *args, **kwargs)


async def _probe_ollama(cfg: JarvisConfig) -> dict[str, Any]:
    url = cfg.data["ollama"]["url"].rstrip("/") + "/api/version"
    try:
        async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT_S) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return {"ok": True, "detail": resp.json().get("version", "unknown")}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


async def _probe_models(cfg: JarvisConfig) -> dict[str, Any]:
    mediator_name = cfg.data["ollama"]["mediator"]
    worker_name = cfg.data["ollama"]["worker"]

    if cfg.data["ollama"].get("mediator_native"):
        # Mediator is served by the model router, not Ollama. /v1/status reports
        # what is actually loaded; /v1/models would answer 200 with no backend up.
        base = (cfg.data["ollama"].get("mediator_url")
                or cfg.data["ollama"]["url"]).rstrip("/")
        loaded, up = None, False
        try:
            async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT_S) as client:
                resp = await client.get(f"{base}/v1/status")
                resp.raise_for_status()
                data = resp.json()
                loaded, up = data.get("loaded"), bool(data.get("up"))
        except Exception:
            pass  # degrade gracefully — reported as not-resident
        same = mediator_name == worker_name
        return {
            "mediator": {"name": mediator_name,
                         "resident": up and loaded == mediator_name},
            # One model serving both roles: the worker is resident exactly when
            # the mediator is, and no eviction happens between them.
            "worker": {"name": worker_name,
                       "resident": (up and loaded == mediator_name) if same
                       else (up and loaded == worker_name)},
        }

    resident: set[str] = set()
    url = cfg.data["ollama"]["url"].rstrip("/") + "/api/ps"
    try:
        async with httpx.AsyncClient(timeout=_HEALTH_TIMEOUT_S) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            for model in resp.json().get("models", []):
                name = model.get("name") or model.get("model")
                if name:
                    resident.add(name)
                    resident.add(name.removesuffix(":latest"))  # ps reports name:latest
    except Exception:
        pass  # health degrades gracefully — models simply report not-resident
    return {
        "mediator": {"name": mediator_name, "resident": mediator_name in resident},
        "worker": {"name": worker_name, "resident": worker_name in resident},
    }


def _probe_db(db: Database) -> dict[str, Any]:
    try:
        db.get_conn().execute("SELECT 1")
        return {"ok": True, "detail": "connected"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


class _LiveComponents(dict):
    """Health view that always reflects live component_status() of the pipeline parts."""

    def __init__(self, stt, tts, mediator):
        super().__init__()
        self._parts = {"stt": stt, "tts": tts, "mediator": mediator}

    def items(self):
        return {k: v.component_status() for k, v in self._parts.items()}.items()

    def values(self):
        return [v.component_status() for v in self._parts.values()]

    def __iter__(self):
        return iter(self._parts)

    def __getitem__(self, k):
        return self._parts[k].component_status()

    def keys(self):
        return self._parts.keys()


def create_app(config: JarvisConfig | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        cfg = config or load_config()
        app.state.config = cfg
        setup_logging(cfg.path_for("hermes_home"))

        db = Database(cfg.path_for("hermes_home") / "jarvis.db")
        bus = EventBus(db)
        bus.bind_loop()

        app.state.db = db
        app.state.bus = bus
        app.state.metrics = metrics_mod.metrics
        # Populated later by audio/mediator pipeline modules as they come online.
        app.state.components = {
            "stt": {"ok": False, "detail": "not initialized"},
            "tts": {"ok": False, "detail": "not initialized"},
            "mediator": {"ok": False, "detail": "not initialized"},
        }
        app.state.pipeline = None  # set by the pipeline wiring once it exists
        app.state.start_time = time.time()

        # Optional cross-module wiring: instantiate the real worker/capability objects when
        # those packages are available, so /tasks/{id}/control and /capabilities/search do
        # real work instead of always 501ing. Never let a broken/partial sibling module take
        # jarvisd's boot down with it.
        app.state.workers = None
        worker_manager_cls = _try_import_attr("jarvisd.workers.manager", "WorkerManager")
        if worker_manager_cls is not None:
            try:
                worker_cfg = cfg.data.get("worker") or {}
                app.state.workers = worker_manager_cls(
                    db, bus, backend=worker_cfg.get("backend", "cloud"),
                    worker_home=str(cfg.path_for("worker_home")),
                    cloud_toolsets=worker_cfg.get("cloud_toolsets"),
                    timeout_s=worker_cfg.get("timeout_s", 900))
                app.state.workers.reconcile_on_boot()
            except Exception:
                app.state.workers = None

        app.state.caps_router = None
        caps_router_cls = _try_import_attr("jarvisd.caps.router", "CapabilityRouter")
        if caps_router_cls is not None:
            try:
                app.state.caps_router = caps_router_cls(
                    ollama_url=cfg.data["ollama"]["url"],
                    embed_model=cfg.data["ollama"]["embed"],
                    db_conn=db.get_conn(),
                )
            except Exception:
                app.state.caps_router = None

        # ---- full voice pipeline (STT/TTS/mediator) -------------------------
        # JARVISD_NO_PIPELINE=1 keeps unit tests fast and model-free.
        reindex_task = None
        if os.environ.get("JARVISD_NO_PIPELINE"):
            yield
            return
        try:
            from .audio.stt import StreamingSTT
            from .audio.tts import StreamingTTS
            from .mediator.loop import Mediator
            from .pipeline import Pipeline
            from . import memory as memory_pkg

            stt_cfg = cfg.data["stt"]
            stt = StreamingSTT(model_size=stt_cfg.get("fallback_model", stt_cfg.get("model", "base.en")),
                               compute_type=stt_cfg.get("compute", "int8"),
                               engine=stt_cfg.get("engine", "parakeet"),
                               parakeet_model=stt_cfg.get(
                                   "parakeet_model", "mlx-community/parakeet-tdt-0.6b-v2"))
            kokoro_dir = cfg.path_for("models") / "kokoro"
            tts = StreamingTTS(model_path=str(kokoro_dir / "kokoro-v1.0.onnx"),
                               voices_path=str(kokoro_dir / "voices-v1.0.bin"),
                               default_voice=cfg.data["tts"]["voice"],
                               default_speed=cfg.data["tts"]["speed"])
            brain_cfg = cfg.data.get("brain") or {}
            mediator = Mediator(ollama_url=(cfg.data["ollama"].get("mediator_url")
                                            or cfg.data["ollama"]["url"]),
                                model=cfg.data["ollama"]["mediator"],
                                num_ctx=cfg.data["ollama"]["mediator_num_ctx"],
                                keep_alive=cfg.data["ollama"]["keep_alive"],
                                native=bool(cfg.data["ollama"].get("mediator_native")),
                                history_turns=cfg.data["budgets"]["mediator_history_turns"],
                                brain=brain_cfg.get("active", "local"),
                                cloud_model=brain_cfg.get("cloud_model", "deepseek-v4.1-flash"),
                                cloud_url=brain_cfg.get(
                                    "cloud_url", "https://opencode.ai/zen/go/v1/chat/completions"),
                                deep_model=brain_cfg.get("deep_model", "minimax-m3"))
            stt.load()
            tts.load()

            class _MemoryFacade:
                """Bind the memory package to jarvisd's shared connection/config."""

                @staticmethod
                def search(q: str, k: int = 6):
                    return memory_pkg.search(
                        q, k, conn=db.get_conn(),
                        ollama_url=cfg.data["ollama"]["url"],
                        embed_model=cfg.data["ollama"]["embed"])

                @staticmethod
                def build_card(q, hits, budget):
                    return memory_pkg.build_card(q, hits, budget)

            if app.state.workers is not None:
                pipeline = Pipeline(cfg, db, bus, stt, tts, mediator,
                                    app.state.workers, _MemoryFacade(),
                                    app.state.caps_router)
                app.state.pipeline = pipeline
                pipeline.reminders.start()
            app.state.stt, app.state.tts, app.state.mediator = stt, tts, mediator
            app.state.components = _LiveComponents(stt, tts, mediator)

            async def _boot_tasks():
                await mediator.warmup()
                try:
                    stats = await run_in_threadpool(
                        memory_pkg.reindex, full=False, conn=db.get_conn(),
                        vault_path=cfg.path_for("vault"),
                        ollama_url=cfg.data["ollama"]["url"],
                        embed_model=cfg.data["ollama"]["embed"])
                    bus.publish({"t": "health", "memory": stats})
                except Exception:
                    pass
                while True:  # periodic incremental reindex
                    await asyncio.sleep(600)
                    try:
                        await run_in_threadpool(
                            memory_pkg.reindex, full=False, conn=db.get_conn(),
                            vault_path=cfg.path_for("vault"),
                            ollama_url=cfg.data["ollama"]["url"],
                            embed_model=cfg.data["ollama"]["embed"])
                    except Exception:
                        pass

            reindex_task = asyncio.get_running_loop().create_task(_boot_tasks())
        except Exception:
            logging.getLogger("jarvisd").exception("pipeline wiring failed — API-only mode")

        yield
        if reindex_task:
            reindex_task.cancel()
        if app.state.pipeline is not None:
            await app.state.pipeline.reminders.stop()

    app = FastAPI(title="jarvisd", version=__version__, lifespan=lifespan)
    app.include_router(ws_router)

    @app.get("/health")
    async def health(request: Request) -> dict[str, Any]:
        cfg: JarvisConfig = request.app.state.config
        components = dict(request.app.state.components)
        components["ollama"] = await _probe_ollama(cfg)
        components["db"] = _probe_db(request.app.state.db)
        pipeline = request.app.state.pipeline
        if pipeline is not None:
            components["turns"] = {"ok": True, "detail": f"{pipeline.vad_label}, mode={pipeline.mode}"}
        models = await _probe_models(cfg)
        # Report what actually answers: the active brain and the active worker
        # backend, not the local router's model when the cloud is in charge.
        mediator = getattr(request.app.state, "mediator", None)
        if mediator is not None and getattr(mediator, "brain", "local") == "cloud":
            models["mediator"] = {"name": getattr(mediator, "cloud_model", "cloud"),
                                  "resident": True, "brain": "cloud"}
        workers = request.app.state.workers
        if workers is not None and workers.backend != "local":
            models["worker"] = {"name": {"cloud": "codecloud"}.get(workers.backend, workers.backend),
                                "resident": True, "backend": workers.backend}
        return {
            "ok": all(c.get("ok") for c in components.values()),
            "version": __version__,
            "uptime_s": round(time.time() - request.app.state.start_time, 1),
            "components": components,
            "models": models,
            "ram": metrics_mod.ram_snapshot(),
        }

    @app.get("/config")
    def get_config(request: Request) -> dict[str, Any]:
        return request.app.state.config.as_dict()

    @app.post("/config")
    async def post_config(request: Request) -> dict[str, Any]:
        patch = await request.json()
        request.app.state.config.save(patch)
        # Apply a worker-backend switch live (no restart) if one was included.
        wb = (patch.get("worker") or {}).get("backend") if isinstance(patch, dict) else None
        workers = request.app.state.workers
        if wb and workers is not None:
            workers.set_backend(wb)
        return request.app.state.config.as_dict()

    @app.get("/backends")
    def get_backends(request: Request) -> dict[str, Any]:
        """Selector data: which engines exist, which is active, which are reachable."""
        workers = request.app.state.workers
        active = workers.backend if workers is not None else \
            (request.app.state.config.data.get("worker") or {}).get("backend", "cloud")
        avail = workers.availability() if workers is not None else {}
        labels = {
            "local": "Local gpt-oss",
            "cloud": "codecloud",
            "codex": "Codex",
            "claude": "Claude Code",
        }
        return {"active": active, "available": avail,
                "backends": ["local", "cloud", "codex", "claude"], "labels": labels}

    @app.post("/backends")
    async def set_backend(request: Request) -> dict[str, Any]:
        body = await request.json()
        name = (body or {}).get("backend", "")
        workers = request.app.state.workers
        if workers is None:
            raise HTTPException(status_code=501, detail="workers not available")
        result = workers.set_backend(name)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "bad backend"))
        request.app.state.config.save({"worker": {"backend": name}})
        return result

    @app.get("/brains")
    def get_brains(request: Request) -> dict[str, Any]:
        """Selector data for the mediator's two brains (SPEC §Brains)."""
        from .mediator.loop import opencode_go_configured

        cfg: JarvisConfig = request.app.state.config
        mediator = getattr(request.app.state, "mediator", None)
        brain_cfg = cfg.data.get("brain") or {}
        active = mediator.brain if mediator is not None else brain_cfg.get("active", "local")
        brains = [
            {"id": "local", "label": "Fast · local gpt-oss",
             "detail": cfg.data["ollama"]["mediator"], "available": True},
            {"id": "cloud", "label": "Smart · OpenCode Go",
             "detail": brain_cfg.get("cloud_model", "deepseek-v4.1-flash"),
             "available": opencode_go_configured()},
        ]
        return {"active": active, "brains": brains}

    @app.post("/brains")
    async def set_brain(request: Request) -> dict[str, Any]:
        body = await request.json()
        brain = (body or {}).get("brain", "")
        mediator = getattr(request.app.state, "mediator", None)
        if mediator is None:
            raise HTTPException(status_code=501, detail="mediator not available")
        result = mediator.set_brain(brain)
        if not result.get("ok"):
            raise HTTPException(status_code=400, detail=result.get("error", "bad brain"))
        request.app.state.config.save({"brain": {"active": brain}})
        bus = request.app.state.bus
        if bus is not None:
            try:
                bus.publish({"t": "brain.changed", "brain": brain})
            except Exception:  # noqa: BLE001 — a bus hiccup must not fail the switch
                pass
        return result

    @app.get("/credits")
    async def get_credits_route(request: Request, refresh: bool = False) -> dict[str, Any]:
        fn = _try_import_attr("jarvisd.credits", "get_credits")
        if fn is None:
            raise HTTPException(status_code=501, detail="credits module unavailable")
        return await run_in_threadpool(fn, refresh)

    @app.get("/tasks")
    def list_tasks(request: Request, status: str | None = None, limit: int = 50) -> dict[str, Any]:
        return {"tasks": request.app.state.db.list_tasks(status=status, limit=limit)}

    @app.get("/tasks/{task_id}")
    def get_task(task_id: str, request: Request) -> dict[str, Any]:
        task = request.app.state.db.get_task(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="task not found")
        return task

    @app.post("/tasks/{task_id}/control")
    async def task_control(task_id: str, request: Request) -> dict[str, Any]:
        body = await request.json()
        action = body.get("action")
        if action not in ("pause", "resume", "cancel", "redelegate"):
            raise HTTPException(status_code=400, detail="action must be one of pause|resume|cancel")
        manager = request.app.state.workers
        if manager is None:
            raise HTTPException(status_code=501, detail="workers.manager not available yet")
        result = await _invoke(manager.control, task_id, action)
        if not result.get("ok"):
            error = result.get("error", "control failed")
            raise HTTPException(status_code=404 if error == "unknown task" else 409, detail=error)
        return {"ok": True, "status": result["status"]}

    @app.post("/say")
    async def say(request: Request) -> dict[str, Any]:
        pipeline = request.app.state.pipeline
        if pipeline is None:
            raise HTTPException(status_code=501, detail="pipeline not initialized")
        body = await request.json()
        text = (body.get("text") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="text required")
        if body.get("interrupt"):
            pipeline.barge_in("api /say interrupt")
        await pipeline._announce(text)
        return {"ok": True}

    @app.post("/converse")
    async def converse(request: Request) -> dict[str, Any]:
        pipeline = request.app.state.pipeline
        if pipeline is None:
            raise HTTPException(status_code=501, detail="pipeline not initialized")
        body = await request.json()
        if body.get("reset"):
            pipeline.mediator.reset()
        text = (body.get("text") or "").strip()
        if not text:
            if body.get("reset"):
                return {"ok": True, "reset": True}
            raise HTTPException(status_code=400, detail="text required")
        return await pipeline.run_turn(text)

    @app.get("/memory/search")
    async def memory_search(request: Request, q: str, k: int = 5) -> dict[str, Any]:
        search_fn = _try_import_attr("jarvisd.memory.search", "search")
        if search_fn is None:
            raise HTTPException(status_code=501, detail="memory.search not implemented yet")
        cfg = request.app.state.config
        # Share jarvisd's one sqlite connection (memory.indexer.get_conn is built to reuse it)
        # instead of letting memory.search open a second writer against the same WAL file.
        hits = await _invoke(
            search_fn, q, k,
            conn=request.app.state.db.get_conn(),
            ollama_url=cfg.data["ollama"]["url"],
            embed_model=cfg.data["ollama"]["embed"],
        )
        build_card = _try_import_attr("jarvisd.memory.cards", "build_card")
        budget = cfg.data["budgets"]["context_card_tokens"]
        card = await _invoke(build_card, q, hits, budget) if build_card else ""
        return {"hits": hits, "card": card, "budget_tokens": budget}

    @app.get("/capabilities/search")
    async def capabilities_search(request: Request, q: str, k: int = 5) -> dict[str, Any]:
        router_obj = request.app.state.caps_router
        if router_obj is None:
            raise HTTPException(status_code=501, detail="caps.router not available yet")
        hits = await _invoke(router_obj.search, q, k)
        return {"hits": hits}

    @app.get("/metrics")
    def get_metrics(request: Request) -> dict[str, Any]:
        return request.app.state.metrics.snapshot()

    @app.get("/traces")
    def get_traces(request: Request, limit: int = 20) -> dict[str, Any]:
        return {"traces": request.app.state.db.recent_traces(limit=limit)}

    return app


app = create_app()


def main() -> None:
    import uvicorn

    cfg = load_config()  # lifespan hasn't run yet at this point, so read config directly
    uvicorn.run(app, host=cfg.data["server"]["host"], port=cfg.data["server"]["port"])


if __name__ == "__main__":
    main()
