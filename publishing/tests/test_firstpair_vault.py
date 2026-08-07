from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


VAULT_PACKAGE = Path(__file__).resolve().parents[1] / "vault"
sys.path.insert(0, str(VAULT_PACKAGE))

from firstpair_vault.compare import compare_vaults  # noqa: E402
from firstpair_vault.config import ConfigError, load_config  # noqa: E402
from firstpair_vault.inventory import inventory  # noqa: E402
from firstpair_vault.projection import project  # noqa: E402


class VaultConfigTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        (self.root / "chapter.md").write_text("# Chapter\n", encoding="utf-8")
        (self.root / "source.md").write_text("# Source\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_config(self, **overrides) -> Path:
        value = {
            "schemaVersion": 1,
            "slug": "fixture",
            "title": "Fixture",
            "profile": "history",
            "sourceCommit": "0123456789abcdef",
            "reader": [{"id": "chapter", "title": "Chapter", "source": "chapter.md", "preview": True}],
            "evidence": [
                {
                    "id": "source",
                    "kind": "source-passage",
                    "source": "source.md",
                    "referencedBy": ["chapter"],
                }
            ],
            "products": {
                "desktop": {"output": "candidate/desktop"},
                "mobile": {"output": "candidate/mobile"},
                "preview": {"output": "candidate/preview", "edition": "preview"},
            },
        }
        value.update(overrides)
        path = self.root / "vault.build.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        return path

    def test_projects_referenced_closure_for_mobile_and_preview(self) -> None:
        config = load_config(self.write_config())
        self.assertEqual(1, len(project(config, "desktop").evidence))
        self.assertEqual(1, len(project(config, "mobile").evidence))
        self.assertEqual(1, len(project(config, "preview").pages))

    def test_rejects_source_traversal(self) -> None:
        path = self.write_config(reader=[{"id": "bad", "title": "Bad", "source": "../bad.md"}])
        with self.assertRaises(ConfigError):
            load_config(path)


class VaultComparisonTests(unittest.TestCase):
    def test_candidate_must_not_regress_declared_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline = root / "baseline"
            candidate = root / "candidate"
            baseline.mkdir()
            candidate.mkdir()
            (baseline / "Home.md").write_text("# Home\n", encoding="utf-8")
            (baseline / "Source.md").write_text("# Source\n", encoding="utf-8")
            (candidate / "Home.md").write_text("# Home\n[[Missing]]\n", encoding="utf-8")
            contract = root / "qa.json"
            contract.write_text(json.dumps({"minimums": {"markdown": 2}}), encoding="utf-8")
            result = compare_vaults(baseline, candidate, contract)
            self.assertFalse(result["passed"])
            self.assertGreaterEqual(len(result["hardRegressions"]), 2)

    def test_inventory_rejects_private_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "Home.md").write_text("# Home\n", encoding="utf-8")
            obsidian = root / ".obsidian"
            obsidian.mkdir()
            (obsidian / "workspace.json").write_text("{}\n", encoding="utf-8")
            self.assertEqual(("private:.obsidian/workspace.json",), inventory(root).unsafe_paths)


if __name__ == "__main__":
    unittest.main()
