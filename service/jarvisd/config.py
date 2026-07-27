"""Load/merge service/jarvisd.toml (SPEC §Config). Tolerates a missing file (defaults apply)
and exposes save() for POST /config patches. No TOML-writer dependency is available in this
venv, so writing back uses a small serializer scoped to this config's flat section/scalar shape.
"""

from __future__ import annotations

import copy
import os
import tomllib
import types
from pathlib import Path
from typing import Any

# service/jarvisd/config.py -> parent(jarvisd) -> parent(service) / jarvisd.toml
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "jarvisd.toml"

DEFAULTS: dict[str, Any] = {
    "server": {"host": "127.0.0.1", "port": 9140},
    "ollama": {
        "url": "http://127.0.0.1:11434",
        "mediator": "gemma4:e4b-it-qat",
        "worker": "granite4.1-local-64k",
        "embed": "nomic-embed-text",
        "mediator_num_ctx": 8192,
        "keep_alive": "30m",
    },
    "stt": {"model": "base.en", "compute": "int8", "device": "cpu", "partial_interval_ms": 600},
    "vad": {"aggressiveness": 2, "endpoint_ms": 500, "min_speech_ms": 200},
    "tts": {"voice": "am_michael", "speed": 1.1, "engine": "kokoro", "fallback": "say"},
    "paths": {
        "vault": "~/ai/memory/obsidian-vault",
        "hermes_home": "~/.hermes/profiles/jarvis-voice",
        "models": "~/ai/models",
    },
    "budgets": {"context_card_tokens": 600, "mediator_history_turns": 12},
}


def _deep_merge(base: dict, overlay: dict) -> dict:
    out = copy.deepcopy(base)
    for key, val in overlay.items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = val
    return out


def _toml_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _dump_toml(data: dict) -> str:
    """Minimal TOML writer for this config's flat [section] key=scalar shape only."""
    lines: list[str] = []
    for section, kv in data.items():
        lines.append(f"[{section}]")
        for key, val in kv.items():
            lines.append(f"{key} = {_toml_scalar(val)}")
        lines.append("")
    return "\n".join(lines)


class JarvisConfig:
    """In-memory config, merged from DEFAULTS + file + env. `data` is the live nested dict."""

    def __init__(self, data: dict[str, Any], path: Path):
        self.data = data
        self.path = path

    def path_for(self, key: str) -> Path:
        """Expanduser'd Path for a [paths] entry (e.g. 'hermes_home', 'vault', 'models')."""
        return Path(self.data["paths"][key]).expanduser()

    def __getattr__(self, name: str) -> Any:
        """Attribute-style section access (cfg.vad.aggressiveness, cfg.tts.voice, ...) as a
        convenience alongside cfg.data["vad"]["aggressiveness"] — consumers (e.g. the voice
        pipeline) read config this way. Only invoked when normal attribute lookup misses, so
        it never shadows .data/.path/methods.
        """
        try:
            section = self.data[name]
        except KeyError:
            raise AttributeError(name) from None
        return types.SimpleNamespace(**section) if isinstance(section, dict) else section

    def as_dict(self) -> dict[str, Any]:
        return copy.deepcopy(self.data)

    def save(self, patch: dict[str, Any]) -> None:
        """Deep-merge a partial patch (e.g. {"tts": {"voice": "x"}}) and persist to disk."""
        self.data = _deep_merge(self.data, patch)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(_dump_toml(self.data), encoding="utf-8")


def load_config(path: Path | None = None) -> JarvisConfig:
    cfg_path = path or DEFAULT_CONFIG_PATH
    data = copy.deepcopy(DEFAULTS)
    if cfg_path.exists():
        with cfg_path.open("rb") as fh:
            data = _deep_merge(data, tomllib.load(fh))
    port_override = os.environ.get("JARVISD_PORT")
    if port_override:
        data["server"]["port"] = int(port_override)
    return JarvisConfig(data, cfg_path)


def write_default_config(path: Path | None = None) -> Path:
    """Create jarvisd.toml with defaults if it doesn't exist yet (idempotent)."""
    cfg_path = path or DEFAULT_CONFIG_PATH
    if not cfg_path.exists():
        cfg_path.parent.mkdir(parents=True, exist_ok=True)
        cfg_path.write_text(_dump_toml(DEFAULTS), encoding="utf-8")
    return cfg_path
