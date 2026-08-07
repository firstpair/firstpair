from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path


VAULT_PACKAGE = Path(__file__).resolve().parents[1] / "vault"
sys.path.insert(0, str(VAULT_PACKAGE))

from firstpair_vault.compare import compare_vaults  # noqa: E402
from firstpair_vault.builder import build_vault  # noqa: E402
from firstpair_vault.config import ConfigError, load_config  # noqa: E402
from firstpair_vault.inventory import inventory  # noqa: E402
from firstpair_vault.guides import compose_guide  # noqa: E402
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
            "sourceCommit": "0123456789abcdef0123456789abcdef01234567",
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
        guide = compose_guide(config, project(config, "preview"))
        self.assertIn("Install Obsidian", guide)
        self.assertIn("Using a history and sources vault", guide)
        self.assertIn("This preview product", guide)
        self.assertIn("Omnighost", guide)

    def test_rejects_source_traversal(self) -> None:
        path = self.write_config(reader=[{"id": "bad", "title": "Bad", "source": "../bad.md"}])
        with self.assertRaises(ConfigError):
            load_config(path)

    def test_accepts_head_as_a_committed_contract_without_a_self_hash(self) -> None:
        subprocess.run(["git", "init", "-q", "--initial-branch=main", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Vault Test"], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "config", "user.email", "vault@example.invalid"],
            check=True,
        )
        path = self.write_config(sourceCommit="HEAD")
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "fixture"], check=True)
        config = load_config(path)
        from firstpair_vault.revisions import resolve_source_commit

        revision = resolve_source_commit(config.repo_root, config.source_commit)
        self.assertEqual(40, len(revision))
        guide = compose_guide(config, project(config, "desktop"), source_revision=revision)
        self.assertIn(f"Source revision: `{revision}`", guide)
        self.assertNotIn("Source revision: `HEAD`", guide)

    def test_parses_a_thin_native_driver_without_shell_commands(self) -> None:
        config = load_config(
            self.write_config(
                nativeDriver={
                    "build": ["python3", "scripts/build.py", "{output}"],
                    "validate": ["python3", "scripts/check.py", "{output}"],
                }
            )
        )
        self.assertIsNotNone(config.native_driver)
        self.assertEqual("python3", config.native_driver.build[0])

    def test_rejects_a_native_driver_without_an_output_placeholder(self) -> None:
        path = self.write_config(
            nativeDriver={
                "build": ["python3", "scripts/build.py"],
                "validate": ["python3", "scripts/check.py", "{output}"],
            }
        )
        with self.assertRaises(ConfigError):
            load_config(path)

    def test_native_driver_builds_validates_and_installs_the_complete_guide(self) -> None:
        scripts = self.root / "scripts"
        scripts.mkdir()
        (scripts / "build.py").write_text(
            "from pathlib import Path\n"
            "import sys\n"
            "root = Path(sys.argv[1])\n"
            "root.mkdir(parents=True)\n"
            "(root / 'Home.md').write_text('# Home\\n')\n",
            encoding="utf-8",
        )
        (scripts / "check.py").write_text(
            "from pathlib import Path\n"
            "import sys\n"
            "root = Path(sys.argv[1])\n"
            "assert (root / 'Home.md').is_file()\n"
            "assert 'firstpair-vault-guide-v2' in (root / 'Guide.md').read_text()\n"
            "assert (root / 'Guide.md').read_bytes() == (root / 'README.md').read_bytes()\n",
            encoding="utf-8",
        )
        path = self.write_config(
            sourceCommit="HEAD",
            nativeDriver={
                "build": [sys.executable, "scripts/build.py", "{output}"],
                "validate": [sys.executable, "scripts/check.py", "{output}"],
            },
        )
        subprocess.run(["git", "init", "-q", "--initial-branch=main", str(self.root)], check=True)
        subprocess.run(["git", "-C", str(self.root), "config", "user.name", "Vault Test"], check=True)
        subprocess.run(
            ["git", "-C", str(self.root), "config", "user.email", "vault@example.invalid"],
            check=True,
        )
        subprocess.run(["git", "-C", str(self.root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-q", "-m", "fixture"], check=True)
        manifest = build_vault(path, "desktop")
        candidate = self.root / "candidate" / "desktop"
        self.assertEqual("firstpair-native-vault-manifest-v1", manifest["schema"])
        self.assertTrue((candidate / "FIRSTPAIR-VAULT-MANIFEST.json").is_file())

    def test_every_profile_and_product_composes_a_complete_manual(self) -> None:
        config = load_config(self.write_config())
        for profile in ("code", "history", "triptych"):
            configured = replace(config, profile=profile)
            for product_name in ("desktop", "mobile", "preview"):
                projected = project(config, product_name)
                guide = compose_guide(
                    configured,
                    replace(projected, product=replace(projected.product, name=product_name)),
                )
                self.assertIn("<!-- firstpair-vault-guide-v2 -->", guide)
                self.assertIn("Install Obsidian", guide)
                self.assertIn("Instructions specific to this book", guide)
                self.assertIn("Build identity", guide)


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
