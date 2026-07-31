"""Credit probe — run by the HERMES venv python (which has httpx), NOT jarvisd's
own venv. Calls jarvisd's vendored provider readers (provider_credits.py) and
prints one JSON line: {"providers": [...]}.

Usage:  <hermes_venv_python> _credits_probe.py [force]

Runs under the hermes venv only because that interpreter has httpx + the codex
app-server on PATH; the reader logic itself is now vendored in-repo
(provider_credits.py) so there's no dependency on any external dashboard plugin.
Any failure prints {"error": "..."} so jarvisd degrades to "unavailable" rather
than crashing.
"""
import asyncio
import importlib.util
import json
import os
import sys

VENDORED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "provider_credits.py")


def main() -> None:
    force = len(sys.argv) > 1 and sys.argv[1] == "force"
    try:
        spec = importlib.util.spec_from_file_location("hjv_provider_credits", VENDORED)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        data = asyncio.run(mod.status(force=force))
        print(json.dumps(data))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)[:300], "providers": []}))


if __name__ == "__main__":
    main()
