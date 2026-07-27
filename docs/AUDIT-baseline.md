# Jarvis Phase 1 baseline — 2026-07-27

## Host
- Mac mini M4, 24 GB RAM (hw.memsize 25769803776), free ~35% at audit time
- macOS Darwin 25.5.0, user `agent` (no sudo; /opt/homebrew owned by `lj` — brew installs impossible)
- Python 3.11.15 at ~/.local/bin/python3.11; ffmpeg present; cmake absent; /usr/bin/say present

## Hermes
- v0.19.0 (2026.7.20), git install at ~/.hermes/hermes-agent, upstream d71033a4, local b6d42340 (+3 carried)
- Profiles: default (~/.hermes, cloud) + local (~/.hermes/profiles/local, granite4.1-local-64k)
- Gateways: LaunchAgents ai.hermes.gateway (pid 90004) + ai.hermes.gateway-local (pid 631); pattern:
  `venv/bin/python -m hermes_cli.main --profile NAME gateway run --replace`, HERMES_HOME=profile dir,
  logs in profile/logs/gateway.log. ensure-gateways LaunchAgent restarts stale gateways every 5min.
- Gateway procs hold NO TCP listen port; separate: dashboard python 127.0.0.1:9119, proxy node 127.0.0.1:9120,
  crypto-trader 9127, node 8790, node 4400.
- Plugins installed (global ~/.hermes/plugins): cronalytics, crypto-trader, hermes-achievements,
  hermes-agent-self-evolution, hermes-chat-bubble, hermes-chronos-forge, hermes-labyrinth,
  hermes-plugin-credits, hermes-plugin-dashboard, signal-engine, web-search-plus

## Services not to disrupt
telegram (both gateways connected), dashboard (9119), proxy (9120), docker, couchdb, n8n,
crypto-trader (+autonomy), signal-engine (ibc-gateway), tailscale, kanban-watchdog, curator,
selfimprove, logrotate, health, cua-driver, selpflow.prewarm, vilnius-nt caddy.

## Ollama 0.30.7 (LaunchAgent local.ollama.serve, :11434)
- granite4.1-local-64k (5.3GB, num_ctx 65536) — warm chat round-trip 0.18–0.42s
- granite4.1:8b, nomic-embed-text
- gemma4:e4b-it-qat pulled 2026-07-27 (6.1GB disk, 3.1GB resident @4k ctx, 7.5B params Q4_0)
  cold load 6.26s, warm round-trip 0.38s
- Only one model resident at a time by default (5min keep_alive) — Jarvis needs keep_alive pinning.

## STT/TTS
- Nothing installed. Brew blocked (ownership). Plan: pip wheels — faster-whisper / mlx-whisper (STT),
  kokoro-onnx (TTS), /usr/bin/say fallback. whisper ggml models at ~/ai/models/whisper/
  (base.en 148MB, small 466MB) for possible later whisper.cpp source build (pip cmake).

## Model tags
- Mediator: gemma4:e4b-it-qat (benchmark 2026-07-26: fastest quick-ops local model)
- Worker: granite4.1-local-64k (best tool reliability local; 64k ctx needs num_ctx alias)
- Embeddings: nomic-embed-text
