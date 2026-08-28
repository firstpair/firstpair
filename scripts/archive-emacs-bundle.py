#!/usr/bin/env python3
"""Create a deterministic, UTF-8-safe ZIP of a FirstPair Emacs bundle.

The archive holds exactly the validated bundle directory under one root folder
named after it. Members are sorted, timestamps fixed, and nothing volatile is
added or removed; the bundle's own manifest remains the inventory of record.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path, PurePosixPath


ARCHIVE_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
EXCLUDED_NAMES = {".DS_Store", "Thumbs.db", "__pycache__"}
EXCLUDED_SUFFIXES = {".elc", ".pyc"}


def members(bundle: Path) -> list[Path]:
    found: list[Path] = []
    for path in sorted(bundle.rglob("*")):
        relative = path.relative_to(bundle)
        if any(part in EXCLUDED_NAMES for part in relative.parts):
            continue
        if path.is_symlink():
            raise SystemExit(f"bundle contains a symlink: {relative}")
        if not path.is_file():
            continue
        if path.suffix in EXCLUDED_SUFFIXES:
            continue
        found.append(path)
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    bundle = args.bundle.resolve(strict=True)
    description = json.loads((bundle / "data" / "bundle.json").read_text(encoding="utf-8"))
    if description.get("schema") != "firstpair-emacs-bundle-v1":
        raise SystemExit(f"not a FirstPair Emacs bundle: {bundle}")
    if not (bundle / "FIRSTPAIR-EMACS-MANIFEST.json").is_file():
        raise SystemExit(f"bundle is not sealed by a manifest: {bundle}")
    root = PurePosixPath(bundle.name)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in members(bundle):
            name = str(root / path.relative_to(bundle).as_posix())
            info = zipfile.ZipInfo(name, date_time=ARCHIVE_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if path.name == "install.sh" else 0o644) << 16
            info.flag_bits |= 0x800  # UTF-8 file names
            archive.writestr(info, path.read_bytes())
            count += 1
    print(json.dumps({"bundle": str(bundle), "output": str(args.output), "members": count, "root": bundle.name}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
