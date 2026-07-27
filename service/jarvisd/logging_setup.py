"""Single logging setup() used by app.py: rotating file (2 MB x 3) + stderr."""

from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

_configured = False


def setup(hermes_home: Path, level: int = logging.INFO) -> logging.Logger:
    global _configured
    logger = logging.getLogger("jarvisd")
    if _configured:
        return logger

    logger.setLevel(level)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    log_dir = Path(hermes_home).expanduser() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    file_handler = RotatingFileHandler(
        log_dir / "jarvisd.log", maxBytes=2 * 1024 * 1024, backupCount=3
    )
    file_handler.setFormatter(fmt)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler(sys.stderr)
    stream_handler.setFormatter(fmt)
    logger.addHandler(stream_handler)

    _configured = True
    return logger
