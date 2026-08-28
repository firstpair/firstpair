"""Deterministic FirstPair Emacs bundle construction."""

from .builder import build, plan
from .package import assemble as assemble_package
from .verify import verify_bundle

__all__ = ["assemble_package", "build", "plan", "verify_bundle"]
