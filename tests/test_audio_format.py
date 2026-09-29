"""Pytest wrapper for ui/src/audio-format.js regression tests.

The actual assertions live in tests/test_audio_format.js (Node) because
the code under test is plain JavaScript (no browser AudioContext
needed — the format helpers are pure). We shell out to Node here so the
suite runs as part of `pytest` like every other test.

Why not a pure-Python implementation? Re-implementing the fade and the
windowed-sinc resampler in Python just to test that they exist in JS
would be a parallel implementation that could drift out of sync with
the production code — the test would pass while the JS regresses. By
running the JS directly we know whatever passes here is what runs in
the browser.

Also runs test_audio_format_old.js, which exercises the same scenarios
against an OLD in-test shim that simulates the pre-fix behavior
(no fade, naive linear resample). That side suite must catch the bug
on every "click" assertion — if it doesn't, the test is vacuous and
should be tightened.
"""
import os
import shutil
import subprocess
import sys

import pytest

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
NODE = shutil.which("node")


@pytest.mark.skipif(NODE is None, reason="node not on PATH")
def test_audio_format_node():
    """Run the JS regression suite under Node."""
    proc = subprocess.run(
        [NODE, "tests/test_audio_format.js"],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, (
        "test_audio_format.js failed\n"
        "--- stdout ---\n" + proc.stdout + "\n"
        "--- stderr ---\n" + proc.stderr + "\n"
    )
    # Sanity: confirm the test suite actually exercised both old and new
    # pipeline assertions. If a future refactor drops the old-path
    # checks, the test stops being a regression test.
    assert "S1 old path" in proc.stdout, "missing old-path assertions"
    assert "S1 new path" in proc.stdout, "missing new-path assertions"


@pytest.mark.skipif(NODE is None, reason="node not on PATH")
def test_audio_format_old_produces_clicks():
    """Sanity check: prove the test catches the bug.

    Runs test_audio_format_old.js, which exercises the same scenarios
    against an OLD in-test shim (no fade, naive linear resample). That
    shim MUST produce detectable clicks for every scenario the new path
    fixes; otherwise the regression test is vacuous. Exit code 0 = the
    bug is detected.
    """
    proc = subprocess.run(
        [NODE, "tests/test_audio_format_old.js"],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, (
        "test_audio_format_old.js did NOT catch the bug — "
        "the regression test is vacuous and needs tightening.\n"
        "--- stdout ---\n" + proc.stdout + "\n"
        "--- stderr ---\n" + proc.stderr + "\n"
    )
    assert "catches the bug" in proc.stdout