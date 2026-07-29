"""Credit probe — run by the HERMES venv python (which has the plugin's deps),
NOT jarvisd's venv. Reuses the maintained hermes-plugin-credits reader so we
never duplicate provider-API logic. Prints one JSON line: {"providers": [...]}.

Usage:  <hermes_venv_python> _credits_probe.py [force]

Kept dependency-free beyond what the credits plugin already imports (httpx,
fastapi). Any failure prints {"error": "..."} so jarvisd degrades to
"unavailable" rather than crashing.
"""
import asyncio
import importlib.util
import json
import os
import sys

PLUGIN = os.path.expanduser(
    "~/.hermes/plugins/hermes-plugin-credits/dashboard/plugin_api.py")


def main() -> None:
    force = len(sys.argv) > 1 and sys.argv[1] == "force"
    try:
        spec = importlib.util.spec_from_file_location("hjv_credits_plugin", PLUGIN)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        data = asyncio.run(mod.status(force=force))
        print(json.dumps(data))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)[:300], "providers": []}))


if __name__ == "__main__":
    main()
