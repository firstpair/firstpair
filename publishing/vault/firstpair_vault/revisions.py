from __future__ import annotations

import subprocess
from pathlib import Path


def repository_head(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    revision = result.stdout.strip()
    if result.returncode != 0 or len(revision) != 40:
        raise RuntimeError(f"vault source is not a Git worktree: {repo_root}")
    return revision


def resolve_source_commit(repo_root: Path, requested: str) -> str:
    head = repository_head(repo_root)
    if requested != "HEAD" and requested != head:
        raise RuntimeError("sourceCommit does not match the source repository HEAD")
    return head


def require_clean_worktree(repo_root: Path) -> None:
    result = subprocess.run(
        ["git", "-C", str(repo_root), "status", "--porcelain"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or result.stdout.strip():
        raise RuntimeError("source repository must be clean before building a vault")
