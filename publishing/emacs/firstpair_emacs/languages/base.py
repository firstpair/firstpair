"""The contract every lexicon language fulfils."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Protocol


@dataclass(frozen=True)
class Entry:
    """One dictionary entry: what a reader looks up."""

    entry_id: str
    headword: str
    part: str
    senses: str
    code: str = ""
    frequency: str = ""


@dataclass(frozen=True)
class Analysis:
    """One reading of an inflected form."""

    form: str
    entry_id: str
    features: str
    enclitic: str = ""
    note: str = ""


@dataclass(frozen=True)
class Projection:
    """The entries and forms a delivered text uses."""

    entries: tuple[Entry, ...]
    forms: tuple[tuple[str, tuple[Analysis, ...]], ...]
    unknown: tuple[str, ...]


@dataclass
class NormaliseSpec:
    """How the reader folds a surface word before lookup, shipped as data."""

    lowercase: bool = True
    combining: str = "strip"  # "strip", "keep", or "diaeresis"
    replace: tuple[tuple[str, str], ...] = ()
    strip: str = "’'"  # characters trimmed from both ends

    def payload(self) -> dict[str, object]:
        return {
            "lowercase": self.lowercase,
            "combining": self.combining,
            "replace": [list(pair) for pair in self.replace],
            "strip": self.strip,
        }


class Language(Protocol):
    code: str
    name: str
    gloss_language: str
    enclitics: tuple[str, ...]
    normalise_spec: NormaliseSpec
    provenance: dict[str, object]

    def load(self, cache: Path, supplements: tuple[Path, ...] = ()) -> None: ...

    def normalise(self, word: str) -> str: ...

    def tokens(self, text: str) -> list[tuple[int, str]]:
        """Return (offset, surface) pairs for the words of TEXT."""
        ...

    def analyse(self, word: str) -> tuple[Analysis, ...]: ...

    def entry(self, entry_id: str) -> Entry: ...

    def part_name(self, part: str) -> str: ...

    def senses(self, entry: Entry) -> str: ...

    def project(self, vocabulary: Iterable[str]) -> Projection: ...

    def complete(self) -> Projection: ...

    def write_tables(self, directory: Path, projection: Projection, *, mode: str, source: dict[str, object]) -> dict[str, object]: ...
