"""Command-line entry point: ``firstpair-emacs``."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from firstpair_vault.revisions import resolve_source_commit

from . import corpus, package
from .builder import build, plan
from .config import PRODUCTS, load
from .guides import compose
from .projection import project
from .verify import verify_bundle


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="firstpair-emacs")
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("plan", "build"):
        command = commands.add_parser(name)
        command.add_argument("config", type=Path)
        command.add_argument("--product", choices=(*PRODUCTS, "all"), required=True)
        if name == "build":
            command.add_argument(
                "--offline",
                action="store_true",
                help="fail instead of fetching pinned lexicon data that is not cached",
            )
    guide = commands.add_parser("guide")
    guide.add_argument("config", type=Path)
    guide.add_argument("--product", choices=PRODUCTS, required=True)
    guide.add_argument("--output", type=Path, required=True)
    lexicon = commands.add_parser("lexicon", help="fetch or verify the pinned lexicon corpus")
    lexicon.add_argument("--language", default="latin")
    lexicon.add_argument("--offline", action="store_true")
    packager = commands.add_parser("package", help="assemble the standalone firstpair-reader package")
    packager.add_argument("--output", type=Path, default=package.PACKAGE_ROOT / "dist")
    validate = commands.add_parser("validate")
    validate.add_argument("--bundle", type=Path, required=True)
    validate.add_argument("--skip-emacs", action="store_true", help="do not open the bundle in Emacs")
    validate.add_argument("--skip-makeinfo", action="store_true", help="do not compile the Texinfo source")
    return root


def _products(config, requested: str) -> tuple[str, ...]:
    if requested == "all":
        return tuple(name for name in PRODUCTS if name in config.products)
    return (requested,)


def main() -> int:
    args = parser().parse_args()
    if args.command == "plan":
        config = load(args.config)
        result = {"products": [plan(args.config, name) for name in _products(config, args.product)]}
    elif args.command == "build":
        config = load(args.config)
        result = {
            "products": [
                build(args.config, name, allow_download=not args.offline)
                for name in _products(config, args.product)
            ]
        }
    elif args.command == "guide":
        config = load(args.config)
        text = compose(
            config,
            project(config, args.product),
            source_revision=resolve_source_commit(config.repo_root, config.core.source_commit),
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
        result = {"guide": str(args.output.resolve()), "bytes": len(text.encode("utf-8"))}
    elif args.command == "package":
        result = package.assemble(args.output.resolve())
    elif args.command == "lexicon":
        spec = corpus.load_corpus(args.language)
        directory = corpus.ensure(spec, allow_download=not args.offline)
        result = {
            "language": spec.language,
            "name": spec.name,
            "cache": str(directory),
            "files": {item.name: item.sha256 for item in spec.files},
            "supplement": str(spec.supplement) if spec.supplement else None,
        }
    else:
        result = verify_bundle(
            args.bundle,
            run_emacs=not args.skip_emacs,
            run_makeinfo=not args.skip_makeinfo,
        )
    print(json.dumps(result, indent=2))
    return 0 if result.get("passed", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
