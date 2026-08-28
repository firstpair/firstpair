"""Pinned upstream lexicon data.

Dictionary corpora are large, rarely change, and are not book content, so they
are not committed to a source repository. FirstPair pins their exact bytes by
SHA-256 in ``lexicon/<language>/SOURCES.json`` and caches them outside the
repository. A build either finds the pinned bytes in the cache or fetches them
once; either way the bundle it produces is determined by the pin, not by
whatever the upstream project published today.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
LEXICON_ROOT = PACKAGE_ROOT / "lexicon"


@dataclass(frozen=True)
class CorpusFile:
    name: str
    url: str
    sha256: str


@dataclass(frozen=True)
class Corpus:
    language: str
    name: str
    license: str
    upstream: str
    files: tuple[CorpusFile, ...]
    supplement: Path | None


def cache_root() -> Path:
    override = os.environ.get("FIRSTPAIR_LEXICON_CACHE")
    if override:
        return Path(override).expanduser()
    return Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "firstpair" / "lexicon"


def load_corpus(language: str) -> Corpus:
    directory = LEXICON_ROOT / language
    payload = json.loads((directory / "SOURCES.json").read_text(encoding="utf-8"))
    if payload.get("schema") != "firstpair-lexicon-source-v1":
        raise ValueError(f"unsupported lexicon source description: {language}")
    supplement = directory / "supplement.tsv"
    return Corpus(
        language=language,
        name=payload["name"],
        license=payload["license"],
        upstream=payload["upstream"],
        files=tuple(
            CorpusFile(name=item["name"], url=item["url"], sha256=item["sha256"])
            for item in payload["files"]
        ),
        supplement=supplement if supplement.is_file() else None,
    )


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ensure(corpus: Corpus, *, allow_download: bool = True) -> Path:
    """Return the cache directory holding the corpus, fetching it if needed."""

    directory = cache_root() / corpus.language
    directory.mkdir(parents=True, exist_ok=True)
    for item in corpus.files:
        destination = directory / item.name
        if destination.is_file() and _digest(destination) == item.sha256:
            continue
        if not allow_download:
            raise RuntimeError(
                f"missing pinned lexicon data: {destination}. "
                f"Run 'firstpair-emacs lexicon --language {corpus.language}' with network access."
            )
        with urlopen(item.url, timeout=120) as response:  # noqa: S310 - pinned https URL
            payload = response.read()
        digest = hashlib.sha256(payload).hexdigest()
        if digest != item.sha256:
            raise RuntimeError(
                f"pinned digest mismatch for {item.name}: expected {item.sha256}, downloaded {digest}"
            )
        destination.write_bytes(payload)
    return directory
