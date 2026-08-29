"""Italian, served by the English Wiktionary extraction published by Kaikki.

The extraction lists every lemma with its English senses and its inflected
forms, and links archaic, apocopic, and alternative forms to their lemmas.
Dante's text still needs help the dictionary cannot give: elided articles and
pronouns (``l'``, ``ch'``), truncated words (``amor``, ``cammin``, ``fuor``),
old verb endings (``dicea``, ``avea``), enclitic pronouns (``dirmi``), and the
diaereses of the Gutenberg text (``sapïenza``). The analyser tries the exact
form first and then a short, ordered list of restorations, and records which
one succeeded so the reader can say "apocope of *amore*" rather than guess.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import re
from typing import Iterable
import unicodedata

from .base import Analysis, Entry, NormaliseSpec, Projection


CORPUS_FILE = "enwiktionary-italian.jsonl"
WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
DIAERESIS = {"ï": "i", "ü": "u", "ë": "e", "ö": "o", "ä": "a"}
SKIPPED_TAGS = {"table-tags", "inflection-template", "canonical", "romanization", "class", "conjugation", "declension"}
# A row tagged "auxiliary" names the helper verb of the compound tenses (avere,
# essere) — often beside "transitive" — and is not a form of the lemma at all.
SKIPPED_ROW_TAGS = {"auxiliary"}
FORM_OF = re.compile(r"^(?P<kind>.*?)\bof\s+(?P<target>[^\s,;:()]+)\s*$")
# A link written only as gloss text: "Dantesque form of gaietto", "obsolete spelling of cuore".
FORM_OF_GLOSS = re.compile(
    r"^(?P<kind>(?:[A-Za-z-]+ ){0,4}(?:form|spelling|variant|misspelling|contraction|abbreviation|apocope|elision|synonym) of)\s+(?P<target>[^\s,;:()]+)\.?\s*$",
    re.IGNORECASE,
)
MINOR_PARTS = {"suffix", "prefix", "infix", "interfix", "abbrev", "symbol", "letter", "character", "punct"}
LATE_PARTS = {"name", "abbrev"}

# Elided clitics and articles, expanded to the forms a dictionary lists.
ELISIONS = {
    "l": ("il", "lo", "la"), "ch": ("che",), "d": ("di", "da"), "m": ("mi",), "t": ("ti",), "s": ("si",),
    "n": ("ne",), "v": ("vi",), "c": ("ci",), "un": ("uno", "una"), "dell": ("dello", "della"),
    "all": ("allo", "alla"), "nell": ("nello", "nella"), "dall": ("dallo", "dalla"), "sull": ("sullo", "sulla"),
    "quell": ("quello", "quella"), "bell": ("bello", "bella"), "com": ("come",), "gl": ("gli",), "cotest": ("cotesto",),
    "quest": ("questo", "questa"), "ond": ("onde",), "sanz": ("senza",), "tutt": ("tutto", "tutta"), "grand": ("grande",),
    "sì": ("sì",), "perch": ("perché",), "anch": ("anche",), "senz": ("senza",), "qualch": ("qualche",),
}
# Forms that begin with an apostrophe: 'l (il), 'n (in), 'ntra (intra).
PROCLITICS = {"l": ("il",), "n": ("in",), "ntra": ("intra", "tra"), "nfin": ("infin", "infino"), "ntorno": ("intorno",), "mperò": ("imperò",), "ntrai": ("entrai",)}
# Dante's usual truncations and old spellings, checked before the generic rules.
RESTORATIONS = {
    "sanza": ("senza",), "elli": ("egli",), "ei": ("egli", "ei"), "lor": ("loro",), "ancor": ("ancora",), "or": ("ora",),
    "pur": ("pure",), "ben": ("bene",), "sol": ("solo", "sole"), "fuor": ("fuori", "furono"), "gran": ("grande",),
    "san": ("santo",), "buon": ("buono",), "bel": ("bello",), "quel": ("quello",), "tal": ("tale",), "qual": ("quale",),
    "uom": ("uomo",), "cor": ("cuore", "core"), "amor": ("amore",), "esser": ("essere",), "aver": ("avere",),
    "son": ("sono",), "sù": ("su",), "giù": ("giù",), "mal": ("male",), "vuol": ("vuole",), "suol": ("suole",),
    "duol": ("duolo", "duole"), "cammin": ("cammino",), "ciascun": ("ciascuno",), "alcun": ("alcuno",), "nessun": ("nessuno",),
    "assai": ("assai",), "però": ("però",), "sen": ("se", "sene"), "men": ("meno",), "fin": ("fine", "fino"),
    "vien": ("viene",), "tien": ("tiene",), "convien": ("conviene",), "dolor": ("dolore",), "color": ("colore", "coloro"),
    "signor": ("signore",), "fior": ("fiore",), "valor": ("valore",), "onor": ("onore",), "ragion": ("ragione",),
    "nuovo": ("nuovo",), "novo": ("nuovo",), "core": ("cuore",), "loco": ("luogo",), "foco": ("fuoco",), "bono": ("buono",),
    "omo": ("uomo",), "morte": ("morte",), "sen’": ("se",), "giuso": ("giù",), "suso": ("su",), "avante": ("avanti",),
    "veder": ("vedere",), "poder": ("potere",), "saver": ("sapere",), "voler": ("volere",), "seguir": ("seguire",),
    "dir": ("dire",), "far": ("fare",), "andar": ("andare",), "star": ("stare",), "parlar": ("parlare",),
    "om": ("uomo",), "tai": ("tali",), "cotai": ("cotali",), "han": ("hanno",), "saran": ("saranno",),
    "avem": ("abbiamo",), "sie": ("sia",), "fue": ("fu",), "fuoro": ("furono",), "feo": ("fece",),
    "giva": ("andava",), "gia": ("andava",), "gir": ("andare",), "gire": ("andare",), "vegno": ("vengo",),
    "vegna": ("venga",), "veggio": ("vedo",), "veggion": ("vedono",), "vegnon": ("vengono",),
    "disio": ("desiderio",), "disiri": ("desideri",), "disire": ("desiderio",), "poria": ("potrebbe",),
    "puote": ("può",), "pon": ("pone",), "vuo": ("vuoi",), "de": ("di",), "ched": ("che",), "e": ("e",),
    "ei": ("egli",), "ella": ("ella",), "lei": ("lei",), "mei": ("miei",), "tuo": ("tuo",), "suo": ("suo",),
    "esta": ("questa",), "esto": ("questo",), "sovra": ("sopra",), "sovresso": ("sopra",), "dallato": ("accanto",),
    "lece": ("lice",), "intrate": ("entrate",), "intrar": ("entrare",), "triunfo": ("trionfo",),
    "rispuosi": ("risposi",), "rispuose": ("rispose",), "tragge": ("trae",), "surge": ("sorge",), "surse": ("sorse",),
    "riede": ("ritorna",), "sembiava": ("sembrava",), "sembiante": ("sembiante",), "imagine": ("immagine",),
    "imagini": ("immagini",), "essilio": ("esilio",), "addorno": ("adorno",), "etterno": ("eterno",),
}
# Old verb endings and their modern shapes, applied when nothing else matches.
ENDINGS = (
    ("eano", "evano"), ("iano", "ivano"), ("ean", "evano"), ("ian", "ivano"), ("ea", "eva"), ("ia", "iva"),
    ("aro", "arono"), ("iro", "irono"), ("ero", "erono"), ("ieno", "evano"), ("ie", "eva"),
    ("ria", "rebbe"), ("rian", "rebbero"), ("riano", "rebbero"), ("an", "anno"), ("on", "ono"), ("em", "iamo"),
    ("ìo", "ì"), ("ue", "u"), ("eo", "ece"),
)
# Spelling alternations between Dante's Tuscan and the dictionary's Italian.
ALTERNATIONS = (
    ("tt", "t"), ("ss", "s"), ("dd", "d"), ("gg", "g"), ("bb", "b"), ("pp", "p"), ("ll", "l"),
    ("o", "uo"), ("uo", "o"), ("e", "ie"), ("ie", "e"), ("u", "o"), ("i", "e"), ("gn", "ng"), ("ng", "gn"),
    ("gr", "cr"), ("gl", "l"), ("gi", "i"), ("lagr", "lacr"), ("ri", "rri"), ("v", "b"), ("ll", "gl"),
    ("ara", "era"), ("mala", "male"), ("ie", "ia"), ("ssi", "si"), ("cc", "c"), ("ff", "f"), ("mm", "m"), ("nn", "n"),
    ("s", "ss"), ("vi", "vvi"), ("simigl", "somigl"), ("ret", "rett"), ("pp", "p"), ("o", "e"),
)
ENCLITICS = (
    "gliene", "gliela", "glielo", "gliele", "glieli", "mene", "tene", "sene", "cene", "vene",
    "melo", "mela", "meli", "mele", "telo", "tela", "teli", "tele", "selo", "sela", "seli", "sele",
    "celo", "cela", "celi", "cele", "velo", "vela", "veli", "vele",
    "gli", "mi", "ti", "si", "ci", "vi", "lo", "la", "li", "le", "ne",
)
PART_NAMES = {
    "noun": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb", "prep": "preposition", "conj": "conjunction",
    "pron": "pronoun", "det": "determiner", "article": "article", "num": "numeral", "intj": "interjection",
    "name": "proper noun", "particle": "particle", "prep_phrase": "prepositional phrase", "phrase": "phrase",
    "contraction": "contraction", "suffix": "suffix", "prefix": "prefix",
}


def normalise(word: str) -> str:
    """Fold a surface word: lower case, no apostrophes, diaereses removed, accents kept."""

    text = unicodedata.normalize("NFC", word).casefold().strip("’'")
    text = "".join(DIAERESIS.get(character, character) for character in text)
    return "".join(character for character in text if character.isalpha() or character in "’'")


def unaccented(word: str) -> str:
    """Drop every accent; Wiktionary's tables mark stress that Italian spelling does not."""

    decomposed = unicodedata.normalize("NFD", word)
    return unicodedata.normalize("NFC", "".join(character for character in decomposed if not unicodedata.combining(character)))


def _targets(sense: dict) -> list[tuple[str, str]]:
    """Return (lemma, features) pairs a form-of sense points at."""

    glosses = [str(value) for value in sense.get("glosses", []) if value]
    kind = glosses[0] if glosses else ""
    match = FORM_OF.match(kind)
    default_features = match.group("kind").strip() if match else kind
    found: list[tuple[str, str]] = []
    if not sense.get("form_of") and not sense.get("alt_of") and glosses:
        written = FORM_OF_GLOSS.match(glosses[0])
        if written:
            target = normalise(written.group("target"))
            if target:
                found.append((target, written.group("kind").strip()))
            return found
    for item in sense.get("form_of", []) + sense.get("alt_of", []):
        raw = str(item.get("word", "")).strip()
        if not raw:
            continue
        features = default_features
        if " of " in raw:
            features, raw = raw.rsplit(" of ", 1)
        raw = raw.split(" and ")[0].strip()
        for part in raw.split():
            target = normalise(part)
            if target:
                found.append((target, features))
            if len(raw.split()) == 1:
                break
    return found


def tokens(text: str) -> list[tuple[int, str]]:
    """Return (offset, surface) pairs; an elided word and what follows it are separate."""

    found: list[tuple[int, str]] = []
    for match in re.finditer(r"[^\W\d_]+(?:[’'](?=[^\W\d_]))?|[’'][^\W\d_]+", text):
        found.append((match.start(), match.group(0)))
    return found


@dataclass
class _Lemma:
    entry_id: str
    headword: str
    part: str
    senses: list[str]
    tags: tuple[str, ...] = ()


@dataclass
class Italian:
    code: str = "italian"
    name: str = "Italian"
    gloss_language: str = "en"
    enclitics: tuple[str, ...] = ENCLITICS
    normalise_spec: NormaliseSpec = field(
        default_factory=lambda: NormaliseSpec(
            lowercase=True, combining="diaeresis", replace=(), strip="’'"
        )
    )
    provenance: dict[str, object] = field(default_factory=dict)
    entries: dict[str, Entry] = field(default_factory=dict)
    lemmas: dict[str, list[str]] = field(default_factory=dict)  # normalised headword -> entry ids
    forms: dict[str, list[tuple[str, str]]] = field(default_factory=dict)  # form -> (entry id, features)
    links: dict[str, list[tuple[str, str]]] = field(default_factory=dict)  # form -> (target lemma, kind)
    own: dict[str, list[str]] = field(default_factory=dict)  # form-of row -> its own entry ids
    relations: dict[str, list[str]] = field(default_factory=dict)  # entry id -> related lemma keys
    link_rows: dict[str, str] = field(default_factory=dict)  # entry id of a form-of row -> its key
    supplement_entries: dict[str, list[str]] = field(default_factory=dict)

    # -- loading -------------------------------------------------------------

    def load(self, cache: Path, supplements: tuple[Path, ...] = ()) -> None:
        path = cache / CORPUS_FILE
        if not path.is_file():
            raise FileNotFoundError(f"missing Italian corpus: {path}")
        counters: dict[str, int] = {}
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = json.loads(line)
                if row.get("lang_code") != "it":
                    continue
                self._add_row(row, counters)
        for supplement in supplements:
            if supplement is not None and supplement.is_file():
                payload = json.loads(supplement.read_text(encoding="utf-8"))
                if isinstance(payload, dict) and isinstance(payload.get("entries"), dict) and "schema" in payload:
                    payload = payload["entries"]
                self._add_supplement(payload, counters)
        self.provenance = {
            CORPUS_FILE: {"bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        }

    def _index_form(self, text: str, entry_id: str, features: str) -> None:
        """List a form under its exact spelling and, when different, without accents."""

        self.forms.setdefault(text, []).append((entry_id, features))
        plain = unaccented(text)
        if plain != text:
            self.forms.setdefault(plain, []).append((entry_id, features))

    def _add_row(self, row: dict, counters: dict[str, int]) -> None:
        word = str(row.get("word", ""))
        key = normalise(word)
        part = str(row.get("pos", ""))
        if not key or not part or word.startswith("-") or part in MINOR_PARTS:
            return
        senses: list[str] = []
        form_links: list[tuple[str, str]] = []
        related: list[str] = []
        for sense in row.get("senses", []):
            glosses = [str(value) for value in sense.get("glosses", []) if value]
            targets = _targets(sense)
            for item in sense.get("synonyms", []) + sense.get("alt_of", []) + sense.get("form_of", []):
                related.append(normalise(str(item.get("word", "")).split(" and ")[0]))
            if targets:
                form_links.extend(targets)
                if glosses:
                    senses.append(glosses[0])
                continue
            if glosses:
                senses.append(glosses[0])
        for item in row.get("synonyms", []):
            related.append(normalise(str(item.get("word", ""))))
        if not senses:
            return
        base = f"{key}|{part}"
        counters[base] = counters.get(base, 0) + 1
        entry_id = base if counters[base] == 1 else f"{base}~{counters[base]}"
        self.entries[entry_id] = Entry(entry_id=entry_id, headword=word, part=part, senses="; ".join(dict.fromkeys(senses)))
        related = [item for item in dict.fromkeys(related) if item and item != key]
        if related:
            self.relations[entry_id] = related
        if form_links:
            for target, kind in form_links:
                self.links.setdefault(key, []).append((target, kind))
            self.own.setdefault(key, []).append(entry_id)
            self.link_rows[entry_id] = key
            # A form-of row may still carry an inflection table; its forms
            # resolve through the row's link when looked up.
            for form in row.get("forms", []):
                if SKIPPED_ROW_TAGS.intersection(form.get("tags", [])):
                    continue
                text = normalise(str(form.get("form", "")))
                tags = tuple(tag for tag in form.get("tags", []) if tag not in SKIPPED_TAGS)
                if text and text != key and tags:
                    self._index_form(text, entry_id, " ".join(tags))
            return
        self.lemmas.setdefault(key, []).append(entry_id)
        plain = unaccented(key)
        if plain != key:
            self.lemmas.setdefault(plain, []).append(entry_id)
        self._index_form(key, entry_id, "lemma")
        for form in row.get("forms", []):
            if SKIPPED_ROW_TAGS.intersection(form.get("tags", [])):
                continue
            text = normalise(str(form.get("form", "")))
            tags = tuple(tag for tag in form.get("tags", []) if tag not in SKIPPED_TAGS)
            if not text or text == key or not tags:
                continue
            self._index_form(text, entry_id, " ".join(tags))

    def _add_supplement(self, payload: dict, counters: dict[str, int]) -> None:
        """Add reviewed entries: ``{form: {"headword", "partOfSpeech", "definitions", "grammar"?}}``."""

        for surface, item in payload.items():
            key = normalise(surface)
            headword = str(item.get("headword", surface))
            part = str(item.get("partOfSpeech", ""))
            definitions = [str(value) for value in item.get("definitions", []) if value]
            if not key or not definitions:
                continue
            lemma_key = normalise(headword)
            entry_id = next((identifier for identifier in self.lemmas.get(lemma_key, []) if self.entries[identifier].part == part), None)
            if entry_id is None:
                base = f"{lemma_key}|{part or 'x'}"
                counters[base] = counters.get(base, 0) + 1
                entry_id = base if counters[base] == 1 else f"{base}~{counters[base]}"
                self.entries[entry_id] = Entry(entry_id=entry_id, headword=headword, part=part, senses="; ".join(definitions))
                self.lemmas.setdefault(lemma_key, []).append(entry_id)
            self.forms.setdefault(key, []).append((entry_id, str(item.get("grammar", "")) or "reviewed form"))
            self.supplement_entries.setdefault(key, []).append(entry_id)

    # -- analysis ------------------------------------------------------------

    @staticmethod
    def normalise(word: str) -> str:
        return normalise(word)

    @staticmethod
    def tokens(text: str) -> list[tuple[int, str]]:
        return tokens(text)

    def _linked(self, target: str, kind: str, depth: int = 2) -> list[tuple[str, str]]:
        """Resolve a form-of target to lemma entries, following a chain of links."""

        found = [(entry_id, kind) for entry_id in self.lemmas.get(target, ())]
        if not found:
            found = [(entry_id, kind) for entry_id in self.lemmas.get(unaccented(target), ())]
        if not found and depth > 0:
            for next_target, next_kind in self.links.get(target, ()):
                found.extend(self._linked(next_target, f"{kind}; {next_kind}" if kind else next_kind, depth - 1))
        return found

    def _rank(self, analysis: Analysis) -> tuple[int, int, int]:
        entry = self.entries[analysis.entry_id]
        return (entry.part in LATE_PARTS, entry.headword[:1].isupper(), 0 if analysis.features != "lemma" else 1)

    def _direct(self, form: str, note: str = "", enclitic: str = "") -> list[Analysis]:
        found: list[Analysis] = []
        seen: set[tuple[str, str]] = set()

        def add(entry_id: str, features: str) -> None:
            if (entry_id, features) in seen:
                return
            seen.add((entry_id, features))
            found.append(Analysis(form=form, entry_id=entry_id, features=features, enclitic=enclitic, note=note))

        for entry_id, features in self.forms.get(form, ()):
            row_key = self.link_rows.get(entry_id)
            if row_key is None:
                add(entry_id, features)
                continue
            resolved = [pair for target, kind in self.links.get(row_key, ()) for pair in self._linked(target, f"{features}; {kind}")]
            if resolved:
                for linked_id, linked_features in resolved:
                    add(linked_id, linked_features)
            else:
                add(entry_id, features)
        for target, kind in self.links.get(form, ()):
            for entry_id, features in self._linked(target, kind):
                add(entry_id, features)
        if not found:
            for entry_id in self.own.get(form, ()):
                add(entry_id, "as written")
        found.sort(key=self._rank)
        return found

    def _candidates(self, form: str) -> list[tuple[str, str]]:
        """Return (candidate, note) pairs to try after the exact form fails, safest first."""

        found: list[tuple[str, str]] = []
        for target in RESTORATIONS.get(form, ()):
            found.append((target, f"Dante's form of {target}"))
        for target in ELISIONS.get(form, ()):
            found.append((target, f"elision of {target}"))
        for target in PROCLITICS.get(form, ()):
            found.append((target, f"elision of {target}"))
        plain = unaccented(form)
        if plain != form:
            found.append((plain, f"written {form}"))
        if len(form) > 1 and form[0] in "nmlrs" and form[1] not in "aeiouàèéìòù":
            found.append(("i" + form, f"elision of i{form}"))
            found.append(("e" + form, f"elision of e{form}"))
        if len(form) > 2:
            for suffix in ("e", "o", "a", "i"):
                found.append((form + suffix, f"apocope of {form + suffix}"))
        for old, new in ENDINGS:
            if form.endswith(old) and len(form) > len(old) + 1:
                found.append((form[: -len(old)] + new, f"old form of {form[: -len(old)] + new}"))
        for old, new in (("ate", "à"), ("ade", "à"), ("ute", "ù"), ("ude", "ù"), ("ite", "ì")):
            if form.endswith(old) and len(form) > 4:
                found.append((form[: -len(old)] + new, f"old form of {form[: -len(old)] + new}"))
        if form.startswith("is") and len(form) > 3 and form[2] not in "aeiouàèéìòù":
            found.append((form[1:], f"prothetic form of {form[1:]}"))
        if len(form) > 2 and form[-1] == "e" and form[-2] in "àèéìòù":
            found.append((form[:-1], f"paragogic form of {form[:-1]}"))
        if len(form) > 2 and form[-1] == "l":
            found.append((form + "lo", f"apocope of {form + 'lo'}"))
            found.append((form + "le", f"apocope of {form + 'le'}"))
        for old, new in ALTERNATIONS:
            if old in form:
                candidate = form.replace(old, new, 1)
                found.append((candidate, f"old spelling of {candidate}"))
                if form.count(old) > 1:
                    found.append((form.replace(old, new), f"old spelling of {form.replace(old, new)}"))
        return found

    def analyse(self, word: str) -> tuple[Analysis, ...]:
        form = normalise(word)
        if not form:
            return ()
        elided = word.rstrip().endswith(("’", "'"))
        if elided:
            for target in ELISIONS.get(form, ()) or ():
                found = self._direct(target, f"elision of {target}")
                if found:
                    return tuple(found)
        direct = self._direct(form)
        if direct:
            return tuple(direct)
        candidates = self._candidates(form)
        for candidate, note in candidates:
            found = self._direct(candidate, note)
            if found:
                return tuple(found)
        # Two restorations at once: a truncated word in an old spelling (maravigliar).
        for candidate, note in candidates:
            if not note.startswith("apocope"):
                continue
            for second, second_note in self._candidates(candidate):
                if second_note.startswith("old spelling"):
                    found = self._direct(second, f"{note}, {second_note}")
                    if found:
                        return tuple(found)
        for enclitic in self.enclitics:
            if len(form) > len(enclitic) + 2 and form.endswith(enclitic):
                stem = form[: -len(enclitic)]
                stems: list[tuple[str, str]] = [(stem, "")]
                if len(stem) > 2 and stem[-1] == enclitic[0] and stem[-2] in "aeiou":
                    # mostrommi = mostrò + mi: the pronoun's consonant doubles after a stressed vowel
                    base = stem[:-1]
                    for accent in ("ò", "à", "é", "ì", "ù", "è"):
                        stems.append((base[:-1] + accent, f"{base[:-1] + accent} + {enclitic}"))
                for candidate, note in stems + self._candidates(stem):
                    found = [
                        item for item in self._direct(candidate, note, enclitic)
                        if self.entries[item.entry_id].part == "verb"
                    ]
                    if found:
                        return tuple(found)
        return ()

    def entry(self, entry_id: str) -> Entry:
        return self.entries[entry_id]

    def related(self, entry_id: str) -> list[str]:
        """Return lemma keys the dictionary relates to ENTRY_ID: synonyms and alternatives."""

        return list(self.relations.get(entry_id, ()))

    @staticmethod
    def part_name(part: str) -> str:
        return PART_NAMES.get(part, part)

    @staticmethod
    def senses(entry: Entry) -> str:
        return entry.senses

    # -- projection and tables ----------------------------------------------

    def project(self, vocabulary: Iterable[str]) -> Projection:
        forms: dict[str, tuple[Analysis, ...]] = {}
        unknown: set[str] = set()
        for word in vocabulary:
            form = normalise(word)
            if not form or form in forms or form in unknown:
                continue
            analyses = self.analyse(form)
            if analyses:
                forms[form] = analyses
            else:
                unknown.add(form)
        used = {analysis.entry_id for analyses in forms.values() for analysis in analyses}
        return Projection(
            entries=tuple(self.entries[entry_id] for entry_id in sorted(used)),
            forms=tuple(sorted(forms.items())),
            unknown=tuple(sorted(unknown)),
        )

    def complete(self) -> Projection:
        return Projection(entries=tuple(self.entries[key] for key in sorted(self.entries)), forms=(), unknown=())

    def write_tables(self, directory: Path, projection: Projection, *, mode: str, source: dict[str, object]) -> dict[str, object]:
        directory.mkdir(parents=True, exist_ok=True)
        rows = {
            "entries.tsv": ("id\theadword\tpart\tcode\tfrequency\tsenses", sorted(
                "\t".join((entry.entry_id, entry.headword, entry.part, entry.code, entry.frequency, entry.senses.replace("\t", " ")))
                for entry in projection.entries
            )),
            "forms.tsv": ("form\tentry\tfeatures\tenclitic", [
                "\t".join((form, analysis.entry_id, (f"{analysis.features} ({analysis.note})" if analysis.note else analysis.features), analysis.enclitic))
                for form, analyses in projection.forms
                for analysis in analyses
            ]),
            "stems.tsv": ("stem\tentry\tindex", []),
            "endings.tsv": ("ending\tpart\tdeclension\tvariant\tstem\tfeatures\torder\tfrequency", []),
        }
        payload: dict[str, object] = {
            "schema": "firstpair-lexicon-v1",
            "language": self.code,
            "mode": mode,
            "entries": len(projection.entries),
            "forms": len(projection.forms),
            "analyses": len(rows["forms.tsv"][1]),
            "unknownForms": len(projection.unknown),
            "source": source,
            "files": {},
        }
        for name, (header, lines) in rows.items():
            text = header + "\n" + "".join(f"{line}\n" for line in lines)
            (directory / name).write_text(text, encoding="utf-8")
            payload["files"][name] = {"rows": len(lines), "bytes": len(text.encode("utf-8")), "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest()}
        (directory / "LEXICON.json").write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
        return payload
