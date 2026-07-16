#!/usr/bin/env python3
"""Create a deterministic, UTF-8-safe ZIP of an Obsidian vault."""

from __future__ import annotations

import argparse
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


ARCHIVE_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def excluded(relative: PurePosixPath) -> bool:
    """Match the publication contract's volatile/private path exclusions."""

    return (
        relative.name == ".DS_Store"
        or ".git" in relative.parts
        or relative.name == "workspace.json"
    )


def archive_info(name: str, *, directory: bool) -> zipfile.ZipInfo:
    if directory and not name.endswith("/"):
        name += "/"
    info = zipfile.ZipInfo(name, date_time=ARCHIVE_TIMESTAMP)
    info.create_system = 3
    info.compress_type = zipfile.ZIP_DEFLATED
    info._compresslevel = 9
    mode = (stat.S_IFDIR | 0o755) if directory else (stat.S_IFREG | 0o644)
    info.external_attr = mode << 16
    if directory:
        info.external_attr |= 0x10
    return info


def publication_members(vault: Path) -> list[tuple[PurePosixPath, Path]]:
    root_name = PurePosixPath(vault.name)
    members: list[tuple[PurePosixPath, Path]] = [(root_name, vault)]
    for path in sorted(vault.rglob("*"), key=lambda item: item.relative_to(vault).as_posix()):
        relative = PurePosixPath(path.relative_to(vault).as_posix())
        if excluded(relative):
            continue
        if path.is_symlink():
            raise ValueError(f"symbolic links are forbidden in a published vault: {relative}")
        if not path.is_dir() and not path.is_file():
            raise ValueError(f"unsupported filesystem entry in published vault: {relative}")
        members.append((root_name / relative, path))
    return members


def build_archive(vault: Path, output: Path, guide: Path | None) -> None:
    vault = vault.expanduser()
    if vault.is_symlink():
        raise ValueError(f"vault root must not be a symbolic link: {vault}")
    vault = vault.resolve(strict=True)
    output = output.expanduser().resolve()
    guide = guide.expanduser().resolve(strict=True) if guide else None
    if not vault.is_dir():
        raise ValueError(f"vault is not a directory: {vault}")
    if output == vault or output.is_relative_to(vault):
        raise ValueError(f"archive output must be outside the vault: {output}")
    if guide is not None and not guide.is_file():
        raise ValueError(f"vault guide is not a regular file: {guide}")

    members = publication_members(vault)
    guide_name = PurePosixPath(vault.name, "README.md") if guide else None
    if guide_name is not None and guide is not None:
        members = [member for member in members if member[0] != guide_name]
        members.append((guide_name, guide))
        members.sort(key=lambda member: member[0].as_posix())
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{output.name}.", suffix=".tmp", dir=output.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(
            temporary,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as archive:
            for archive_path, source in members:
                if source.is_dir():
                    archive.writestr(archive_info(archive_path.as_posix(), directory=True), b"")
                else:
                    info = archive_info(archive_path.as_posix(), directory=False)
                    info.file_size = source.stat().st_size
                    with source.open("rb") as source_file, archive.open(info, "w") as target:
                        shutil.copyfileobj(source_file, target, length=1024 * 1024)
        temporary.chmod(0o644)
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--guide", type=Path)
    args = parser.parse_args()
    try:
        build_archive(args.vault, args.output, args.guide)
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
