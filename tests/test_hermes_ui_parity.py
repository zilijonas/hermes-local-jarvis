"""Hermes UI vendored copy must match the canonical build (from
hermes-ui/templates/test_hermes_ui_parity.py, __DIST__ set for this repo).

Skips off-machine (no canonical checkout). Fix a failure with:
~/ai/repos/hermes-ui/bin/hui-sync jarvis-voice
"""
from pathlib import Path

import pytest

CANON = Path.home() / "ai/repos/hermes-ui/dist/VERSION"
VENDORED = Path(__file__).resolve().parents[1] / "hermes-plugin/dashboard/dist" / "hui" / "VERSION"


@pytest.mark.skipif(not CANON.exists(), reason="hermes-ui checkout not present")
def test_vendored_hermes_ui_matches_canonical():
    assert VENDORED.exists(), f"missing {VENDORED}; run hermes-ui/bin/hui-sync"
    assert VENDORED.read_text().strip() == CANON.read_text().strip(), (
        "vendored Hermes UI is stale; run ~/ai/repos/hermes-ui/bin/hui-sync"
    )


def test_vendored_bundle_present():
    d = VENDORED.parent
    for name in ("hermes-ui.js", "hermes-ui.css", "boot.js", "vendor/echarts/echarts.min.js"):
        assert (d / name).exists(), f"missing hui/{name}"
