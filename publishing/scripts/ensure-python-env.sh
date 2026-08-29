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

Publishing projects should pin Python with .tool-versions and declare helper
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

# A project that pins its interpreter with uv's own .python-version (and may
# keep managed interpreters under .uv-python) is resolved by uv itself; only
# projects without that pin take the interpreter asdf selects for them.
if [[ -f "$repo_root/.python-version" ]]; then
  if [[ -d "$repo_root/.uv-python" ]]; then
    export UV_PYTHON_INSTALL_DIR="$repo_root/.uv-python"
  fi
  uv "${uv_args[@]}" >/dev/null
else
  asdf_python="$(cd "$repo_root" && asdf which python 2>/dev/null || true)"
  if [[ -n "$asdf_python" && -x "$asdf_python" ]]; then
    uv "${uv_args[@]}" --python "$asdf_python" >/dev/null
  else
    uv "${uv_args[@]}" >/dev/null
  fi
fi

if [[ ! -x "$python_path" ]]; then
  echo "Python runtime was not created at $python_path" >&2
  exit 1
fi

printf '%s\n' "$python_path"
