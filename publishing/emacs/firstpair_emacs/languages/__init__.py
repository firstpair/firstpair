"""Languages the FirstPair lexicon can analyse.

Every language exposes the same small surface to the builder and the reader:
a normalisation rule, an analyser that turns an inflected form into lexicon
entries with grammatical features, a projection of the entries and forms a
delivered text uses, and the tables that ship in the bundle. Latin is served
by Whitaker's WORDS; Italian by the English Wiktionary extraction with
Dante-aware normalisation. Adding a language means adding one module here.
"""

from __future__ import annotations

from .base import Analysis, Entry, Language, Projection


def get(code: str) -> Language:
    if code == "latin":
        from .latin import Latin

        return Latin()
    if code == "italian":
        from .italian import Italian

        return Italian()
    raise ValueError(f"unsupported lexicon language: {code}")


__all__ = ["Analysis", "Entry", "Language", "Projection", "get"]
