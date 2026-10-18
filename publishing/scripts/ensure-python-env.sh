#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "${1:-${REPO_ROOT:-.}}" && pwd)"
python_path="${PUBLISHING_PYTHON:-$repo_root/.venv/bin/python}"

if [[ -n "${PUBLISHING_PYTHON:-}" && -x "$python_path" ]]; then
  printf '%s\n' "$python_path"
  exit 0
fi

if [[ ! -f "$repo_root/pyproject.toml" ]]; then
  if [[ -x "$python_path" ]]; then
    printf '%s\n' "$python_path"
    exit 0
  fi
  cat >&2 <<EOF
missing $repo_root/pyproject.toml

Publishing projects may pin Python with uv's .python-version and declare helper
dependencies such as Pillow in pyproject.toml, then run uv sync.
EOF
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to create the publishing Python environment" >&2
  exit 1
fi

# `uv sync` is intentionally run even when `.venv/bin/python` already exists:
# publishing dependencies can change while an ignored local environment stays
# behind. With a lockfile this is a cheap no-op when the environment is current.
uv_args=(sync --project "$repo_root" --no-dev)
if [[ -f "$repo_root/uv.lock" ]]; then
  uv_args+=(--locked)
fi

# uv alone manages Python. A project may pin its interpreter with
# .python-version (and keep managed interpreters under .uv-python); otherwise
# uv picks the newest interpreter it manages, which install-toolchain.sh keeps
# at the latest stable CPython.
if [[ -d "$repo_root/.uv-python" ]]; then
  export UV_PYTHON_INSTALL_DIR="$repo_root/.uv-python"
fi
uv "${uv_args[@]}" >/dev/null

if [[ ! -x "$python_path" ]]; then
  echo "Python runtime was not created at $python_path" >&2
  exit 1
fi

printf '%s\n' "$python_path"
