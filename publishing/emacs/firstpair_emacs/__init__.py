"""Deterministic FirstPair Emacs bundle construction."""

from .builder import build, plan
from .verify import verify_bundle

__all__ = ["build", "plan", "verify_bundle"]
