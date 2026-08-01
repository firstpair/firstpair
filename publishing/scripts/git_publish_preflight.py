#!/usr/bin/env python3
"""Require a clean Git repository whose HEAD is present at its remote source.

Local publishing uses an attached branch with a configured upstream and verifies
the upstream directly with ``git ls-remote``.  A detached checkout is accepted
only when the caller explicitly identifies it as a CI remote checkout; its HEAD
must then be contained in a fetched remote-tracking branch.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import os
from pathlib import Path
import re
import shutil
import subprocess


class GitPublishPreflightError(RuntimeError):
    """The repository cannot safely supply a publishable source revision."""


@dataclass(frozen=True)
class GitPublishState:
    root: str
    commit: str
    branch: str | None
    upstream: str


def _git(path: str, *args: str) -> subprocess.CompletedProcess[str]:
    command = ["git", "-C", path, *args]
    environment = dict(os.environ)
    environment["GIT_TERMINAL_PROMPT"] = "0"
    try:
        return subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=60,
            env=environment,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return subprocess.CompletedProcess(command, 124, "", str(error))


def _output(result: subprocess.CompletedProcess[str], operation: str) -> str:
    if result.returncode != 0:
        detail = (result.stderr.strip() or result.stdout.strip()).splitlines()
        suffix = f": {detail[0][:240]}" if detail else ""
        raise GitPublishPreflightError(f"could not {operation}{suffix}")
    return result.stdout.strip()


def _repository_root(path: str) -> str:
    candidate = os.path.realpath(path)
    result = _git(candidate, "rev-parse", "--show-toplevel")
    root = _output(result, "find the Git repository root")
    if not root:
        raise GitPublishPreflightError("Git returned an empty repository root")
    return os.path.realpath(root)


def _require_not_busy(root: str) -> None:
    git_dir = _output(
        _git(root, "rev-parse", "--absolute-git-dir"),
        "inspect the Git directory",
    )
    busy_paths = (
        "index.lock",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    )
    active = [name for name in busy_paths if Path(git_dir, name).exists()]
    if active:
        raise GitPublishPreflightError(
            "repository has an unfinished Git operation: " + ", ".join(active)
        )


def _require_clean(root: str) -> None:
    status = _output(
        _git(root, "status", "--porcelain=v1", "--untracked-files=all"),
        "inspect the worktree",
    )
    if status:
        sample = "; ".join(status.splitlines()[:5])
        more = " …" if len(status.splitlines()) > 5 else ""
        raise GitPublishPreflightError(
            f"repository is not clean ({sample}{more}); commit and push all changes first"
        )


def _valid_commit(value: str) -> bool:
    return bool(re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", value.lower()))


def _require_attached_upstream(root: str, commit: str) -> GitPublishState:
    branch_result = _git(root, "symbolic-ref", "--quiet", "--short", "HEAD")
    if branch_result.returncode != 0 or not branch_result.stdout.strip():
        raise GitPublishPreflightError(
            "detached HEAD; check out a branch with a configured upstream before publishing"
        )
    branch = branch_result.stdout.strip()
    upstream = _output(
        _git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"),
        f"resolve the upstream of {branch}; configure one with git push --set-upstream",
    )
    upstream_commit = _output(
        _git(root, "rev-parse", "--verify", "@{upstream}"),
        f"resolve {upstream}",
    ).lower()
    if upstream_commit != commit:
        raise GitPublishPreflightError(
            f"HEAD {commit[:12]} does not equal {upstream} {upstream_commit[:12]}; "
            "push the branch and resolve any divergence first"
        )

    remote = _output(
        _git(root, "config", "--get", f"branch.{branch}.remote"),
        f"resolve the remote for {branch}",
    )
    merge_ref = _output(
        _git(root, "config", "--get", f"branch.{branch}.merge"),
        f"resolve the remote branch for {branch}",
    )
    remote_result = _git(root, "ls-remote", "--exit-code", remote, merge_ref)
    remote_output = _output(
        remote_result,
        f"verify {merge_ref} at remote {remote}",
    )
    remote_commits = {
        line.split()[0].lower()
        for line in remote_output.splitlines()
        if line.split() and _valid_commit(line.split()[0])
    }
    if remote_commits != {commit}:
        shown = ", ".join(sorted(value[:12] for value in remote_commits)) or "no commit"
        raise GitPublishPreflightError(
            f"remote {remote} reports {shown} for {merge_ref}, not HEAD {commit[:12]}; "
            "push the branch first"
        )
    return GitPublishState(root=root, commit=commit, branch=branch, upstream=upstream)


def _require_ci_remote_checkout(root: str, commit: str) -> GitPublishState:
    remotes = _output(_git(root, "remote"), "list Git remotes").splitlines()
    if "origin" not in remotes:
        raise GitPublishPreflightError(
            "detached CI checkout has no origin remote"
        )
    containing = _output(
        _git(root, "branch", "--remotes", "--contains", commit),
        "verify the detached checkout against fetched remote branches",
    )
    branches = [line.strip().lstrip("* ") for line in containing.splitlines() if line.strip()]
    if not any(branch.startswith("origin/") and branch != "origin/HEAD" for branch in branches):
        raise GitPublishPreflightError(
            f"detached HEAD {commit[:12]} is not contained in a fetched origin branch"
        )
    return GitPublishState(
        root=root,
        commit=commit,
        branch=None,
        upstream=next(branch for branch in branches if branch.startswith("origin/")),
    )


def require_clean_pushed_repo(
    path: str,
    *,
    allow_detached_ci_checkout: bool = False,
) -> GitPublishState:
    """Return the verified source state or raise ``GitPublishPreflightError``."""
    if shutil.which("git") is None:
        raise GitPublishPreflightError("git executable not found")
    root = _repository_root(path)
    _require_not_busy(root)
    _require_clean(root)
    commit = _output(_git(root, "rev-parse", "--verify", "HEAD"), "resolve HEAD").lower()
    if not _valid_commit(commit):
        raise GitPublishPreflightError(f"Git returned an invalid HEAD commit: {commit!r}")

    if allow_detached_ci_checkout:
        return _require_ci_remote_checkout(root, commit)
    branch = _git(root, "symbolic-ref", "--quiet", "--short", "HEAD")
    if branch.returncode == 0 and branch.stdout.strip():
        return _require_attached_upstream(root, commit)
    return _require_attached_upstream(root, commit)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repository", nargs="+", help="repository or path inside it")
    parser.add_argument(
        "--allow-detached-ci-checkout",
        action="store_true",
        help="accept a clean detached HEAD contained in a fetched origin branch",
    )
    args = parser.parse_args()

    seen: set[str] = set()
    for path in args.repository:
        try:
            state = require_clean_pushed_repo(
                path,
                allow_detached_ci_checkout=args.allow_detached_ci_checkout,
            )
        except GitPublishPreflightError as error:
            raise SystemExit(f"Git publish preflight failed for {path}: {error}") from error
        if state.root in seen:
            continue
        seen.add(state.root)
        location = state.branch or "detached CI checkout"
        print(
            f"Git publish preflight passed: {state.root} "
            f"({location}, {state.commit[:12]}, {state.upstream})"
        )


if __name__ == "__main__":
    main()
