#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "${REPO_ROOT:-.}" && pwd)"
python_path="${PUBLISHING_PYTHON:-$repo_root/.venv/bin/python}"

if [[ -x "$python_path" ]]; then
  printf '%s\n' "$python_path"
  exit 0
fi

if [[ ! -f "$repo_root/pyproject.toml" ]]; then
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

asdf_python="$(asdf which python 2>/dev/null || true)"
if [[ -n "$asdf_python" && -x "$asdf_python" ]]; then
  uv sync --project "$repo_root" --no-dev --python "$asdf_python" >/dev/null
else
  uv sync --project "$repo_root" --no-dev >/dev/null
fi

if [[ ! -x "$python_path" ]]; then
  echo "Python runtime was not created at $python_path" >&2
  exit 1
fi

printf '%s\n' "$python_path"
