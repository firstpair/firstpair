"""Latin, served by William Whitaker's WORDS through ``firstpair_emacs.lexicon``."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Iterable

from .. import lexicon
from .base import Analysis, Entry, NormaliseSpec, Projection


class Latin:
    code = "latin"
    name = "Latin"
    gloss_language = "en"
    enclitics = lexicon.ENCLITICS
    normalise_spec = NormaliseSpec(lowercase=True, combining="strip", replace=(("j", "i"), ("v", "u")))

    def __init__(self) -> None:
        self.words: lexicon.WordsData | None = None
        self.provenance: dict[str, object] = {}

    def load(self, cache: Path, supplements: tuple[Path, ...] = ()) -> None:
        self.words = lexicon.load_words(cache, supplements[0] if supplements else None)
        for extra in supplements[1:]:
            lexicon.add_supplement(self.words, extra)
        self.provenance = self.words.provenance

    @staticmethod
    def normalise(word: str) -> str:
        return lexicon.normalise(word)

    @staticmethod
    def tokens(text: str) -> list[tuple[int, str]]:
        return lexicon.iter_words(text)

    def analyse(self, word: str) -> tuple[Analysis, ...]:
        assert self.words is not None
        return tuple(
            Analysis(form=item.form, entry_id=item.entry_id, features=item.features, enclitic=item.enclitic)
            for item in self.words.analyse(word)
        )

    def _convert(self, entry: lexicon.Entry) -> Entry:
        return Entry(
            entry_id=entry.entry_id,
            headword=entry.headword,
            part=entry.part,
            senses=lexicon._clean_senses(entry.senses),
            code=" ".join(entry.code),
            frequency=entry.frequency,
        )

    def entry(self, entry_id: str) -> Entry:
        assert self.words is not None
        return self._convert(self.words.entries[entry_id])

    @staticmethod
    def part_name(part: str) -> str:
        return lexicon.PART_NAMES.get(part, part)

    @staticmethod
    def senses(entry: Entry) -> str:
        return entry.senses

    def _projection(self, raw: lexicon.Projection) -> Projection:
        self._raw = raw
        return Projection(
            entries=tuple(self._convert(entry) for entry in raw.entries),
            forms=tuple(
                (form, tuple(Analysis(form=a.form, entry_id=a.entry_id, features=a.features, enclitic=a.enclitic) for a in analyses))
                for form, analyses in raw.forms
            ),
            unknown=raw.unknown,
        )

    def project(self, vocabulary: Iterable[str]) -> Projection:
        assert self.words is not None
        return self._projection(lexicon.project(self.words, vocabulary))

    def complete(self) -> Projection:
        assert self.words is not None
        return self._projection(lexicon.complete(self.words))

    def write_tables(self, directory: Path, projection: Projection, *, mode: str, source: dict[str, object]) -> dict[str, object]:
        assert self.words is not None
        return lexicon.write_tables(directory, self.words, self._raw, language=self.code, mode=mode, source=source)
