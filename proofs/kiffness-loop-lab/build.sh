#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BOOK_ROOT="proofs/kiffness-loop-lab" "$ROOT/publishing/scripts/build-firstpair-book.sh"
