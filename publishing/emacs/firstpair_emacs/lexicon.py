"""Offline lexicon compilation for FirstPair Emacs bundles.

The bundle ships a language lexicon so the reader's dictionary window works
with no network, no external binary, and no per-lookup analysis cost. This
module owns the Latin implementation over William Whitaker's public-domain
WORDS data: it parses the dictionary and inflection tables, analyses inflected
forms, and projects the subset actually used by a delivered text into the flat
tables the Emacs reader loads.

The delivered contract is three tab-separated tables plus one metadata file;
see ``publishing/emacs/EMACS-DELIVERY.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path
import hashlib
import json
import re
import unicodedata


DICTIONARY_LINE = re.compile(
    r"^(?P<stems>.{76})(?P<codes>.{24})"
    r"(?P<age>[A-Z])\s(?P<area>[A-Z])\s(?P<geo>[A-Z])\s(?P<frequency>[A-Z])\s(?P<source>[A-Z])\s"
    r"(?P<senses>.*)$"
)
STEM_WIDTH = 19
EMPTY_STEM = "zzz"
ENCLITICS = ("que", "ne", "ve", "cum")

PART_NAMES = {
    "N": "noun",
    "V": "verb",
    "VPAR": "participle",
    "ADJ": "adjective",
    "ADV": "adverb",
    "PREP": "preposition",
    "CONJ": "conjunction",
    "INTERJ": "interjection",
    "PRON": "pronoun",
    "NUM": "numeral",
    "PACK": "pronoun",
    "SUPINE": "supine",
}
FEATURE_NAMES = {
    "NOM": "nominative",
    "VOC": "vocative",
    "GEN": "genitive",
    "DAT": "dative",
    "ABL": "ablative",
    "ACC": "accusative",
    "LOC": "locative",
    "S": "singular",
    "P": "plural",
    "M": "masculine",
    "F": "feminine",
    "N": "neuter",
    "C": "common",
    "PRES": "present",
    "IMPF": "imperfect",
    "FUT": "future",
    "PERF": "perfect",
    "PLUP": "pluperfect",
    "FUTP": "future perfect",
    "ACTIVE": "active",
    "PASSIVE": "passive",
    "IND": "indicative",
    "SUB": "subjunctive",
    "IMP": "imperative",
    "INF": "infinitive",
    "PPL": "participle",
    "POS": "positive",
    "COMP": "comparative",
    "SUPER": "superlative",
    "1": "first person",
    "2": "second person",
    "3": "third person",
}
# Grammatical fields that carry no information when Whitaker leaves them open.
UNMARKED = {"X", "0"}


def normalise(word: str) -> str:
    """Fold a Latin form to the shape Whitaker's tables are keyed on."""

    decomposed = unicodedata.normalize("NFKD", word)
    plain = "".join(character for character in decomposed if not unicodedata.combining(character))
    lowered = plain.lower().replace("j", "i").replace("v", "u")
    return "".join(character for character in lowered if character.isalpha())


@dataclass(frozen=True)
class Entry:
    entry_id: str
    headword: str
    part: str
    code: tuple[str, ...]
    stems: tuple[str, ...]
    spelling: tuple[str, ...]
    senses: str
    age: str
    frequency: str

    @property
    def declension(self) -> str:
        return self.code[0] if self.code else ""

    @property
    def variant(self) -> str:
        return self.code[1] if len(self.code) > 1 else "0"

    @property
    def gender(self) -> str:
        return self.code[2] if self.part == "N" and len(self.code) > 2 else "X"


@dataclass(frozen=True)
class Ending:
    part: str
    declension: str
    variant: str
    stem: int
    text: str
    features: tuple[str, ...]
    frequency: str
    order: int


@dataclass(frozen=True)
class Analysis:
    form: str
    entry_id: str
    features: str
    enclitic: str = ""
    order: int = 0
    weight: int = 0
    priority: int = 0


@dataclass
class WordsData:
    entries: dict[str, Entry] = field(default_factory=dict)
    endings: dict[str, tuple[Ending, ...]] = field(default_factory=dict)
    stems: dict[str, tuple[str, ...]] = field(default_factory=dict)
    provenance: dict[str, object] = field(default_factory=dict)

    def analyse(self, word: str) -> tuple[Analysis, ...]:
        form = normalise(word)
        if not form:
            return ()
        results = list(self._analyse_exact(form, ""))
        if results:
            return tuple(results)
        for enclitic in ENCLITICS:
            if len(form) > len(enclitic) + 1 and form.endswith(enclitic):
                results = list(self._analyse_exact(form[: -len(enclitic)], enclitic))
                if results:
                    return tuple(results)
        return ()

    def _analyse_exact(self, form: str, enclitic: str) -> list[Analysis]:
        seen: set[tuple[str, str]] = set()
        results: list[Analysis] = []
        for split in range(len(form), -1, -1):
            stem, ending = form[:split], form[split:]
            candidates = self.stems.get(stem)
            if not candidates:
                continue
            for candidate in self.endings.get(ending, ()):  # noqa: B007 - explicit pairing below
                for entry_id in candidates:
                    entry = self.entries[entry_id]
                    if not _agrees(entry, candidate, stem):
                        continue
                    features = describe(candidate)
                    key = (entry_id, features)
                    if key in seen:
                        continue
                    seen.add(key)
                    results.append(
                        Analysis(
                            form=form,
                            entry_id=entry_id,
                            features=features,
                            enclitic=enclitic,
                            order=candidate.order,
                            weight=_frequency_rank(candidate.frequency),
                            priority=_priority(candidate),
                        )
                    )
        results.sort(key=self._rank)
        return results

    def _rank(self, analysis: Analysis) -> tuple[int, int, int, int, int, str]:
        entry = self.entries[analysis.entry_id]
        return (
            _frequency_rank(entry.frequency),
            analysis.weight,
            analysis.priority,
            analysis.order,
            _frequency_rank(entry.age),
            analysis.entry_id,
        )


def _agrees(entry: Entry, ending: Ending, stem: str) -> bool:
    if ending.stem > len(entry.stems):
        return False
    if entry.stems[ending.stem - 1] != stem:
        return False
    if ending.part == entry.part:
        pass
    elif ending.part in {"VPAR", "SUPINE"} and entry.part == "V":
        pass
    elif ending.part == "PRON" and entry.part == "PACK":
        pass
    else:
        return False
    if ending.declension not in UNMARKED and entry.declension != ending.declension:
        return False
    if entry.part == "N":
        marked = next((feature for feature in ending.features if feature in GENDERS), "X")
        if not _gender_agrees(entry.gender, marked):
            return False
    if ending.variant not in UNMARKED and entry.variant not in UNMARKED:
        if entry.variant != ending.variant:
            return False
    return True


GENDERS = frozenset({"M", "F", "N", "C"})
FREQUENCY_ORDER = "ABCDEFIMN"


# When several readings survive, offer the one a reader most likely met.
MOOD_PRIORITY = {"IND": 0, "SUB": 2, "INF": 3, "IMP": 4, "PPL": 5}
CASE_PRIORITY = {"NOM": 0, "ACC": 1, "GEN": 2, "DAT": 3, "ABL": 4, "VOC": 5, "LOC": 6}


def _priority(ending: Ending) -> int:
    return sum(
        table[feature]
        for table in (MOOD_PRIORITY, CASE_PRIORITY)
        for feature in ending.features
        if feature in table
    )


def _gender_agrees(entry_gender: str, ending_gender: str) -> bool:
    """Whitaker marks an ending C when it serves masculine and feminine nouns."""

    if "X" in {entry_gender, ending_gender}:
        return True
    if entry_gender == ending_gender:
        return True
    if ending_gender == "C":
        return entry_gender in {"M", "F"}
    if entry_gender == "C":
        return ending_gender in {"M", "F"}
    return False


def describe(ending: Ending) -> str:
    features = ending.features
    if ending.part in {"N", "V", "VPAR", "SUPINE"}:
        features = tuple(feature for feature in features if feature not in GENDERS)
    words = [FEATURE_NAMES.get(feature, feature.lower()) for feature in features]
    label = " ".join(word for word in words if word)
    part = PART_NAMES.get(ending.part, ending.part.lower())
    return f"{label} {part}".strip() if label else part


# The principal parts a reader expects to see above a definition.
HEADWORD_PARTS = {
    "N": ((("NOM", "S"), 1), (("GEN", "S"), 2)),
    "ADJ": ((("NOM", "S", "M"), 1), (("NOM", "S", "F"), 2), (("NOM", "S", "N"), 2)),
    "NUM": ((("NOM", "S", "M"), 1),),
    "PRON": ((("NOM", "S"), 1),),
    "PACK": ((("NOM", "S"), 1),),
    "V": ((("PRES", "ACTIVE", "IND", "1", "S"), 1), (("PRES", "ACTIVE", "INF"), 2)),
}
DEPONENT_PARTS = ((("PRES", "PASSIVE", "IND", "1", "S"), 1), (("PRES", "PASSIVE", "INF"), 2))


def _generate(entry: Entry, by_part: dict[str, tuple[Ending, ...]], required: tuple[str, ...], stem: int) -> str:
    if stem > len(entry.stems) or not entry.stems[stem - 1]:
        return ""
    written = entry.spelling[stem - 1]
    wanted = set(required)
    matches = [
        ending
        for ending in by_part.get(entry.part, ())
        if ending.stem == stem and wanted <= set(ending.features) and _agrees(entry, ending, entry.stems[stem - 1])
    ]
    if not matches:
        return ""
    best = min(matches, key=lambda ending: (_frequency_rank(ending.frequency), ending.order))
    return written + best.text


def headword_of(entry: Entry, by_part: dict[str, tuple[Ending, ...]]) -> str:
    """Return the dictionary form a reader would look up, with principal parts."""

    template = HEADWORD_PARTS.get(entry.part, ())
    if entry.part == "V" and {"DEP", "SEMIDEP"} & set(entry.code):
        template = DEPONENT_PARTS
    generated = [_generate(entry, by_part, required, stem) for required, stem in template]
    parts: list[str] = []
    for candidate in generated:
        if candidate and candidate not in parts:
            parts.append(candidate)
    if not parts:
        parts = [stem for stem in entry.spelling[:1] if stem]
    return ", ".join(parts) if parts else entry.spelling[0]


def parse_dictionary(
    text: str, endings: dict[str, tuple[Ending, ...]]
) -> tuple[dict[str, Entry], dict[str, tuple[str, ...]]]:
    by_part: dict[str, list[Ending]] = {}
    for group in endings.values():
        for ending in group:
            by_part.setdefault(ending.part, []).append(ending)
    parts_index = {part: tuple(items) for part, items in by_part.items()}
    entries: dict[str, Entry] = {}
    stems: dict[str, list[str]] = {}
    counters: dict[str, int] = {}
    for line in text.splitlines():
        match = DICTIONARY_LINE.match(line)
        if not match:
            continue
        raw_stems = tuple(
            match.group("stems")[index : index + STEM_WIDTH].strip()
            for index in range(0, 4 * STEM_WIDTH, STEM_WIDTH)
        )
        written = tuple("" if stem in {"", EMPTY_STEM, "-"} else stem for stem in raw_stems)
        cleaned = tuple(normalise(stem) for stem in written)
        codes = match.group("codes").split()
        if not codes:
            continue
        part = codes[0]
        draft = Entry(
            entry_id="",
            headword="",
            part=part,
            code=tuple(codes[1:]),
            stems=cleaned,
            spelling=written,
            senses=match.group("senses").strip(),
            age=match.group("age"),
            frequency=match.group("frequency"),
        )
        headword = headword_of(draft, parts_index)
        base = normalise(headword.split(",", 1)[0]) or cleaned[0] or part.lower()
        counters[base] = counters.get(base, 0) + 1
        entry_id = base if counters[base] == 1 else f"{base}~{counters[base]}"
        entry = Entry(
            entry_id=entry_id,
            headword=headword,
            part=part,
            code=tuple(codes[1:]),
            stems=cleaned,
            spelling=written,
            senses=match.group("senses").strip(),
            age=match.group("age"),
            frequency=match.group("frequency"),
        )
        entries[entry_id] = entry
        for stem in {stem for stem in cleaned if stem}:
            stems.setdefault(stem, []).append(entry_id)
    return entries, {stem: tuple(ids) for stem, ids in stems.items()}


def parse_inflections(text: str) -> dict[str, tuple[Ending, ...]]:
    endings: dict[str, list[Ending]] = {}
    order = 0
    for line in text.splitlines():
        row = line.split("--", 1)[0].strip()
        if not row:
            continue
        fields = row.split()
        if len(fields) < 5 or fields[0] not in PART_NAMES:
            continue
        frequency = fields[-1]
        body = fields[:-2]
        if body[-1].isdigit():
            length, text_ending, offset = int(body[-1]), "", 1
        else:
            length, text_ending, offset = int(body[-2]), body[-1], 2
        if len(text_ending) != length:
            continue
        stem_field = body[-offset - 1]
        if not stem_field.isdigit():
            continue
        part = body[0]
        grammar = body[1 : -offset - 1]
        declension = grammar[0] if grammar and _is_code(grammar[0]) else "X"
        variant = grammar[1] if len(grammar) > 1 and _is_code(grammar[1]) else "0"
        features = tuple(
            item for item in grammar[2 if declension != "X" else 0 :] if item not in UNMARKED
        )
        order += 1
        ending = Ending(
            part=part,
            declension=declension,
            variant=variant,
            stem=int(stem_field),
            text=normalise(text_ending),
            features=features,
            frequency=frequency,
            order=order,
        )
        endings.setdefault(ending.text, []).append(ending)
    return {text: tuple(items) for text, items in endings.items()}


def _frequency_rank(letter: str) -> int:
    position = FREQUENCY_ORDER.find(letter)
    return position if position >= 0 else len(FREQUENCY_ORDER)


def _is_code(value: str) -> bool:
    return value.isdigit() or value == "X"


def load_words(directory: Path, supplement: Path | None = None) -> WordsData:
    dictionary = directory / "DICTLINE.GEN"
    inflections = directory / "INFLECTS.LAT"
    for required in (dictionary, inflections):
        if not required.is_file():
            raise FileNotFoundError(f"missing WORDS data file: {required}")
    endings = parse_inflections(inflections.read_text(encoding="latin-1"))
    entries, stems = parse_dictionary(dictionary.read_text(encoding="latin-1"), endings)
    index = {stem: list(ids) for stem, ids in stems.items()}
    if supplement is not None:
        for entry, declared in parse_supplement(supplement.read_text(encoding="utf-8")):
            entry_id, ordinal = entry.entry_id, 1
            while entry_id in entries:
                ordinal += 1
                entry_id = f"{entry.entry_id}~{ordinal}"
            entry = replace(entry, entry_id=entry_id)
            entries[entry.entry_id] = entry
            for stem in set(declared):
                index.setdefault(stem, []).append(entry.entry_id)
    stems = {stem: tuple(ids) for stem, ids in index.items()}
    provenance = {
        name: {
            "bytes": (directory / name).stat().st_size,
            "sha256": hashlib.sha256((directory / name).read_bytes()).hexdigest(),
        }
        for name in ("DICTLINE.GEN", "INFLECTS.LAT")
    }
    return WordsData(entries=entries, endings=endings, stems=stems, provenance=provenance)


# --- supplement -------------------------------------------------------------
#
# Whitaker's engine hard-codes a few paradigms instead of listing them in
# DICTLINE. FirstPair restores them from an auditable table so a bundle's
# dictionary is complete on its own terms. In that table "-" marks an absent
# stem and "." marks a stem that is genuinely empty.

SUPPLEMENT_COLUMNS = 10


def parse_supplement(text: str) -> list[tuple[Entry, tuple[str, ...]]]:
    rows: list[tuple[Entry, tuple[str, ...]]] = []
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split("\t")
        if len(fields) != SUPPLEMENT_COLUMNS:
            raise ValueError(f"supplement row must have {SUPPLEMENT_COLUMNS} columns: {line!r}")
        written = tuple("" if field == "-" else ("" if field == "." else field) for field in fields[:4])
        declared = tuple(index for index, field in enumerate(fields[:4]) if field != "-")
        entry = Entry(
            entry_id=fields[4],
            headword=fields[5],
            part=fields[6],
            code=tuple(fields[7].split()),
            stems=tuple(normalise(stem) for stem in written),
            spelling=written,
            senses=fields[8],
            age="X",
            frequency="A",
        )
        rows.append((entry, tuple(entry.stems[index] for index in declared)))
    return rows


def add_supplement(words: WordsData, supplement: Path) -> None:
    """Add a further supplement table to loaded WORDS data."""

    index = {stem: list(ids) for stem, ids in words.stems.items()}
    for entry, declared in parse_supplement(supplement.read_text(encoding="utf-8")):
        entry_id, ordinal = entry.entry_id, 1
        while entry_id in words.entries:
            ordinal += 1
            entry_id = f"{entry.entry_id}~{ordinal}"
        entry = replace(entry, entry_id=entry_id)
        words.entries[entry.entry_id] = entry
        for stem in set(declared):
            index.setdefault(stem, []).append(entry.entry_id)
    words.stems = {stem: tuple(ids) for stem, ids in index.items()}


def iter_words(text: str) -> list[tuple[int, str]]:
    """Return (offset, word) pairs for every alphabetic run in ``text``."""

    return [(match.start(), match.group(0)) for match in re.finditer(r"[^\W\d_]+", text, re.UNICODE)]


# --- projection -------------------------------------------------------------


@dataclass(frozen=True)
class Projection:
    entries: tuple[Entry, ...]
    forms: tuple[tuple[str, tuple[Analysis, ...]], ...]
    unknown: tuple[str, ...]


def project(words: WordsData, vocabulary) -> Projection:
    """Keep only the entries and forms a delivered text actually uses."""

    forms: dict[str, tuple[Analysis, ...]] = {}
    unknown: set[str] = set()
    for word in vocabulary:
        form = normalise(word)
        if not form or form in forms or form in unknown:
            continue
        analyses = words.analyse(form)
        if analyses:
            forms[form] = analyses
        else:
            unknown.add(form)
    used = {analysis.entry_id for analyses in forms.values() for analysis in analyses}
    entries = tuple(words.entries[entry_id] for entry_id in sorted(used))
    return Projection(
        entries=entries,
        forms=tuple(sorted(forms.items())),
        unknown=tuple(sorted(unknown)),
    )


def complete(words: WordsData) -> Projection:
    """Ship the whole dictionary without a per-form index."""

    return Projection(entries=tuple(words.entries[key] for key in sorted(words.entries)), forms=(), unknown=())


def _clean_senses(senses: str) -> str:
    return " ".join(senses.replace("|", " ").split()).strip()


def _row(*fields: object) -> str:
    return "\t".join(str(field).replace("\t", " ").replace("\n", " ") for field in fields)


def write_tables(
    directory: Path,
    words: WordsData,
    projection: Projection,
    *,
    language: str,
    mode: str,
    source: dict[str, object],
) -> dict[str, object]:
    """Write the four delivered lexicon files and return their metadata."""

    directory.mkdir(parents=True, exist_ok=True)
    entries = [
        _row(entry.entry_id, entry.headword, entry.part, " ".join(entry.code), entry.frequency, _clean_senses(entry.senses))
        for entry in projection.entries
    ]
    forms = [
        _row(form, analysis.entry_id, analysis.features, analysis.enclitic)
        for form, analyses in projection.forms
        for analysis in analyses
    ]
    kept = {entry.entry_id for entry in projection.entries}
    stems = [
        _row(stem, entry.entry_id, index + 1)
        for entry in projection.entries
        for index, stem in enumerate(entry.stems)
        if stem and entry.entry_id in kept
    ]
    endings = [
        _row(
            ending.text,
            ending.part,
            ending.declension,
            ending.variant,
            ending.stem,
            describe(ending),
            ending.order,
            ending.frequency,
        )
        for group in words.endings.values()
        for ending in group
    ]
    written = {
        "entries.tsv": ("id\theadword\tpart\tcode\tfrequency\tsenses", sorted(entries)),
        "forms.tsv": ("form\tentry\tfeatures\tenclitic", forms),
        "stems.tsv": ("stem\tentry\tindex", sorted(set(stems))),
        "endings.tsv": ("ending\tpart\tdeclension\tvariant\tstem\tfeatures\torder\tfrequency", sorted(endings)),
    }
    payload: dict[str, object] = {
        "schema": "firstpair-lexicon-v1",
        "language": language,
        "mode": mode,
        "entries": len(projection.entries),
        "forms": len(projection.forms),
        "analyses": len(forms),
        "unknownForms": len(projection.unknown),
        "source": source,
        "files": {},
    }
    for name, (header, rows) in written.items():
        text = header + "\n" + "".join(f"{row}\n" for row in rows)
        (directory / name).write_text(text, encoding="utf-8")
        payload["files"][name] = {
            "rows": len(rows),
            "bytes": len(text.encode("utf-8")),
            "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        }
    (directory / "LEXICON.json").write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload
