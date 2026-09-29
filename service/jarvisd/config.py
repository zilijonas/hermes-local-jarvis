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
    # Section name is historical. Only `embed` still runs on Ollama; the mediator
    # and worker are served by the model router on 8090.
    "ollama": {
        "url": "http://127.0.0.1:11434",
        "mediator": "gpt-oss-20b-mxfp4",
        "worker": "gpt-oss-20b-mxfp4",
        "embed": "nomic-embed-text",
        "mediator_num_ctx": 8192,
        "keep_alive": "30m",
        # The mediator may live somewhere other than Ollama. Empty -> use `url`.
        # `mediator_native` selects real tool schemas over the JSON-line
        # protocol; required for gpt-oss-20b (see mediator/prompt.py).
        "mediator_url": "http://127.0.0.1:8090",
        "mediator_native": True,
    },
    # STT: Parakeet-TDT on MLX; `model` is the faster-whisper fallback (audio/stt.py).
    "stt": {"engine": "parakeet", "parakeet_model": "mlx-community/parakeet-tdt-0.6b-v2",
            "model": "base.en", "compute": "int8", "device": "cpu", "partial_interval_ms": 400},
    # Hands-free turn taking: Silero VAD + Smart Turn v3 (audio/turn.py). webrtcvad
    # (`engine = "webrtc"`, `endpoint_ms`) is the fallback when the models are missing.
    # 2026-09-29: defaults raised to 2500 ms so a sub-2.5 s intra-utterance pause
    # stays a single turn; `utt_finalize_ms` is the pipeline-level silence cap.
    "vad":{"engine":"smart_turn","quiet_ms":250,"max_pause_ms":2500,
           "turn_threshold":0.5,"min_speech_ms":200,"endpoint_ms":800,
           "utt_finalize_ms":2500,
           "aggressiveness":3,
           "silero_model":"~/ai/models/silero/silero_vad.onnx",
           "smart_turn_model":"~/ai/models/smart-turn/smart-turn-v3.2-cpu.onnx"},
    "tts": {"voice": "am_michael", "speed": 1.1, "engine": "kokoro", "fallback": "say"},
    "paths": {
        "vault": "~/ai/memory/obsidian-vault",
        # jarvisd's own state (jarvis.db, logs). Historical key name: until
        # 2026-09-28 this was the `jarvis-voice` Hermes profile, removed so it can't
        # be picked by accident in the dashboard profile switcher.
        "hermes_home": "~/ai/state/jarvis-voice",
        # Lean, profile-free Hermes home for the LOCAL worker backend (no `-p`).
        "worker_home": "~/ai/state/jarvis-voice/hermes-home",
        "models": "~/ai/models",
    },
    "budgets": {"context_card_tokens": 600, "mediator_history_turns": 12},
    "worker": {
        # Measured 2026-09-28: the local backend (gpt-oss-20b worker) takes
        # 30-60s even for `df -h`; cloud (codecloud = OpenCode Go + jev-router)
        # did the same task in 5.4s. Cloud is now the default delegate_task engine.
        "backend": "cloud",
        # [] = the default profile's own toolsets (the full Hermes agent). `-t` in
        # oneshot mode only knows built-in toolsets and drops plugin ones such as
        # mail, so an explicit list silently loses email (measured 2026-09-28).
        "cloud_toolsets": [],
        "timeout_s": 900,
    },
    "brain": {
        # The mediator (voice conversation driver) can run on either brain;
        # delegate_task's worker backend above is independent of this.
        "active": "cloud",  # 2026-09-28: faster + 12/12 vs 8-10/12; local = automatic fallback
        "cloud_model": "deepseek-v4.1-flash",
        "cloud_url": "https://opencode.ai/zen/go/v1/chat/completions",
        "deep_model": "minimax-m3",
    },
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
    if isinstance(value, list):
        # worker.cloud_toolsets etc. -- inline TOML array of scalars.
        return "[" + ", ".join(_toml_scalar(v) for v in value) + "]"
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

    def __init__(self, data: dict[str, Any], path: Path, settings_path: Path | None = None):
        self.data = data
        self.path = path
        self.settings_path = settings_path or settings_path_for(path)

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
        """Deep-merge a partial patch (e.g. {"tts": {"voice": "x"}}) and persist it.

        Runtime choices (brain, worker backend, voice) go to a small settings.toml
        overlay in the STATE dir, never into the git-tracked jarvisd.toml: rewriting
        that file on every UI click stripped its comments and turned a QA click on
        "Claude" into a committed default (2026-09-28)."""
        self.data = _deep_merge(self.data, patch)
        current: dict[str, Any] = {}
        if self.settings_path.exists():
            with self.settings_path.open("rb") as fh:
                current = tomllib.load(fh)
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(_dump_toml(_deep_merge(current, patch)), encoding="utf-8")


STATE_SETTINGS_PATH = Path("~/ai/state/jarvis-voice/settings.toml").expanduser()


def settings_path_for(cfg_path: Path) -> Path:
    """Runtime overlay: the state dir for the real service, a sibling file otherwise
    (tests, throwaway configs). JARVISD_SETTINGS overrides both."""
    env = os.environ.get("JARVISD_SETTINGS")
    if env:
        return Path(env).expanduser()
    if Path(cfg_path).resolve() == DEFAULT_CONFIG_PATH.resolve():
        return STATE_SETTINGS_PATH
    return Path(cfg_path).with_name(Path(cfg_path).stem + ".settings.toml")


def load_config(path: Path | None = None) -> JarvisConfig:
    cfg_path = path or DEFAULT_CONFIG_PATH
    data = copy.deepcopy(DEFAULTS)
    if cfg_path.exists():
        with cfg_path.open("rb") as fh:
            data = _deep_merge(data, tomllib.load(fh))
    overlay = settings_path_for(cfg_path)
    if overlay.exists():
        try:
            with overlay.open("rb") as fh:
                data = _deep_merge(data, tomllib.load(fh))
        except (OSError, tomllib.TOMLDecodeError):
            pass  # a broken overlay must never stop jarvisd booting
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
