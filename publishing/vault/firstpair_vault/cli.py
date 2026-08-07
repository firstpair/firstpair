from __future__ import annotations

import argparse
import json
from pathlib import Path

from .builder import build_vault, plan_vault
from .compare import baseline_contract, compare_vaults
from .config import load_config
from .guides import compose_guide
from .projection import project
from .revisions import resolve_source_commit


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="firstpair-vault")
    commands = root.add_subparsers(dest="command", required=True)
    for name in ("plan", "build"):
        command = commands.add_parser(name)
        command.add_argument("config", type=Path)
        command.add_argument("--product", choices=("desktop", "mobile", "preview", "all"), required=True)
    snapshot = commands.add_parser("snapshot")
    snapshot.add_argument("--baseline", type=Path, required=True)
    guide = commands.add_parser("guide")
    guide.add_argument("config", type=Path)
    guide.add_argument("--product", choices=("desktop", "mobile", "preview"), required=True)
    guide.add_argument("--output", type=Path, required=True)
    compare = commands.add_parser("compare")
    compare.add_argument("--baseline", type=Path, required=True)
    compare.add_argument("--candidate", type=Path, required=True)
    compare.add_argument("--contract", type=Path)
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "plan":
        config = load_config(args.config)
        names = (
            tuple(name for name in ("desktop", "mobile", "preview") if name in config.products)
            if args.product == "all"
            else (args.product,)
        )
        result = {"products": [plan_vault(args.config, name) for name in names]}
    elif args.command == "build":
        config = load_config(args.config)
        names = (
            tuple(name for name in ("desktop", "mobile", "preview") if name in config.products)
            if args.product == "all"
            else (args.product,)
        )
        result = {"products": [build_vault(args.config, name) for name in names]}
    elif args.command == "snapshot":
        result = baseline_contract(args.baseline)
    elif args.command == "guide":
        config = load_config(args.config)
        text = compose_guide(
            config,
            project(config, args.product),
            source_revision=resolve_source_commit(config.repo_root, config.source_commit),
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
        result = {"guide": str(args.output.resolve()), "bytes": len(text.encode("utf-8"))}
    else:
        result = compare_vaults(args.baseline, args.candidate, args.contract)
    print(json.dumps(result, indent=2))
    return 0 if result.get("passed", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
