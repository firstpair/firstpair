from __future__ import annotations

import importlib.util
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
ARCHIVER = PACKAGE_ROOT.parents[1] / "scripts" / "archive-vault.py"


def first_open_bytes() -> bytes:
    """Return the one canonical, archive-validated first-open workspace."""

    specification = importlib.util.spec_from_file_location(
        "firstpair_archive_vault", ARCHIVER
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"could not load canonical workspace contract: {ARCHIVER}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module.FIRST_OPEN_BYTES
