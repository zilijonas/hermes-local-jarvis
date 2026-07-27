"""Ensures `service/` (parent of the jarvisd package) is importable regardless of the cwd
pytest is invoked from.
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Unit tests run against the API skeleton without loading whisper/kokoro/mediator.
# Integration tests that want the full pipeline unset this explicitly.
os.environ.setdefault("JARVISD_NO_PIPELINE", "1")
