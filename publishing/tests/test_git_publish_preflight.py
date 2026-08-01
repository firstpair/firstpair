#!/usr/bin/env python3
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


FIRSTPAIR_ROOT = Path(__file__).resolve().parents[2]
PREFLIGHT = FIRSTPAIR_ROOT / "publishing" / "scripts" / "git_publish_preflight.py"
TEXTPACK = FIRSTPAIR_ROOT / "publishing" / "scripts" / "textpack.py"
STAMP_BLOG = FIRSTPAIR_ROOT / "publishing" / "scripts" / "stamp-versioned-blog.sh"
PUBLISH_BLOG = FIRSTPAIR_ROOT / "publishing" / "scripts" / "publish-versioned-blog.sh"


class GitPublishPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="firstpair-git-preflight-")
        self.work = Path(self.temporary.name)
        self.remote = self.work / "origin.git"
        self.repo = self.work / "source"
        self._run("git", "init", "--bare", str(self.remote))
        self._run("git", "init", "--initial-branch=main", str(self.repo))
        self._git("config", "user.name", "FirstPair Test")
        self._git("config", "user.email", "firstpair-test@example.invalid")
        (self.repo / "assets").mkdir()
        (self.repo / "assets" / "headboard.png").write_bytes(b"fixture-headboard\n")
        (self.repo / "post.md").write_text(
            "# Fixture post\n\n![Headboard](assets/headboard.png)\n",
            encoding="utf-8",
        )
        self._git("add", "post.md", "assets/headboard.png")
        self._git("commit", "-m", "Add fixture post")
        self._git("remote", "add", "origin", str(self.remote))
        self._git("push", "--set-upstream", "origin", "main")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _run(
        self,
        *command: str,
        check: bool = True,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            command,
            cwd=cwd,
            env={**os.environ, **(env or {})},
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(
                f"command failed ({result.returncode}): {' '.join(command)}\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        return result

    def _git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return self._run("git", "-C", str(self.repo), *args, check=check)

    def _preflight(self, *extra: str) -> subprocess.CompletedProcess[str]:
        return self._run(
            sys.executable,
            str(PREFLIGHT),
            *extra,
            str(self.repo),
            check=False,
        )

    def _build_textpack(
        self,
        output: Path | None = None,
    ) -> tuple[subprocess.CompletedProcess[str], Path]:
        output = output or (self.work / "fixture.textpack")
        result = self._run(
            sys.executable,
            str(TEXTPACK),
            str(self.repo / "post.md"),
            "--name",
            "fixture",
            "--out",
            str(output),
            check=False,
        )
        return result, output

    def test_clean_pushed_source_builds_git_stamped_textpack(self) -> None:
        preflight = self._preflight()
        self.assertEqual(preflight.returncode, 0, preflight.stderr)
        commit = self._git("rev-parse", "HEAD").stdout.strip()

        result, output = self._build_textpack()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(output.is_file())
        with zipfile.ZipFile(output) as archive:
            info = json.loads(archive.read("fixture.textbundle/info.json"))
        provenance = info["omnighost"]["provenance"]
        self.assertEqual(provenance["schema"], "omnighost-textpack-v1")
        self.assertEqual(provenance["gitCommit"], commit)
        self.assertRegex(provenance["payloadSha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(self._git("status", "--porcelain").stdout, "")

    def test_pack_only_commit_does_not_rotate_provenance_or_archive_bytes(self) -> None:
        source_commit = self._git("rev-parse", "HEAD").stdout.strip()
        output = self.repo / "dist" / "fixture.textpack"

        first_result, _ = self._build_textpack(output)
        self.assertEqual(first_result.returncode, 0, first_result.stderr)
        first_bytes = output.read_bytes()
        self._git("add", "dist/fixture.textpack")
        self._git("commit", "-m", "Add generated textpack")
        self._git("push")
        pack_commit = self._git("rev-parse", "HEAD").stdout.strip()
        self.assertNotEqual(pack_commit, source_commit)

        second_result, _ = self._build_textpack(output)
        self.assertEqual(second_result.returncode, 0, second_result.stderr)
        self.assertEqual(output.read_bytes(), first_bytes)
        with zipfile.ZipFile(output) as archive:
            info = json.loads(archive.read("fixture.textbundle/info.json"))
        self.assertEqual(info["omnighost"]["provenance"]["gitCommit"], source_commit)
        self.assertEqual(self._git("status", "--porcelain").stdout, "")

    def test_versioned_delivery_requires_committed_pushed_stamped_handoff(self) -> None:
        source_commit = self._git("rev-parse", "HEAD").stdout.strip()
        environment = {
            "REPO_ROOT": str(self.repo),
            "BLOG_VERSION": "1.2.3",
            "BLOG_DOMAIN": "example.invalid",
        }
        stamped = self._run(
            str(STAMP_BLOG),
            str(self.repo / "post.md"),
            cwd=self.repo,
            env=environment,
        )
        self.assertIn("handoff: commit and push", stamped.stdout)

        stable = self.repo / "dist" / "source.textpack"
        marker = self.repo / "dist" / "VERSION.md"
        versioned = self.repo / "dist" / f"source (1.2.3-{source_commit[:6]}).textpack"
        self.assertTrue(stable.is_file())
        self.assertTrue(marker.is_file())
        self.assertTrue(versioned.is_symlink())

        delivery = self.work / "delivery"
        delivery.mkdir()
        refused = self._run(
            str(PUBLISH_BLOG),
            str(self.repo / "post.md"),
            str(delivery),
            cwd=self.repo,
            env=environment,
            check=False,
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn("repository is not clean", refused.stderr)
        self.assertEqual(list(delivery.iterdir()), [])

        self._git("add", "dist")
        self._git("commit", "-m", "Stamp fixture textpack")
        self._git("push")
        published = self._run(
            str(PUBLISH_BLOG),
            str(self.repo / "post.md"),
            str(delivery),
            cwd=self.repo,
            env=environment,
        )
        destination = delivery / versioned.name
        self.assertIn(f"published: {destination}", published.stdout)
        self.assertEqual(destination.read_bytes(), stable.read_bytes())
        self.assertEqual(self._git("status", "--porcelain").stdout, "")

    def test_dirty_repository_is_rejected_before_archive_write(self) -> None:
        (self.repo / "unrelated.txt").write_text("dirty\n", encoding="utf-8")

        result, output = self._build_textpack()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repository is not clean", result.stderr)
        self.assertFalse(output.exists())

    def test_ahead_branch_is_rejected(self) -> None:
        (self.repo / "local.txt").write_text("not pushed\n", encoding="utf-8")
        self._git("add", "local.txt")
        self._git("commit", "-m", "Local only")

        result = self._preflight()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not equal origin/main", result.stderr)

    def test_remote_advance_is_detected_even_with_stale_tracking_ref(self) -> None:
        second = self.work / "second"
        self._run("git", "clone", "--branch", "main", str(self.remote), str(second))
        self._run("git", "-C", str(second), "config", "user.name", "Second Writer")
        self._run(
            "git",
            "-C",
            str(second),
            "config",
            "user.email",
            "second@example.invalid",
        )
        (second / "post.md").write_text("# Remote advance\n", encoding="utf-8")
        self._run("git", "-C", str(second), "add", "post.md")
        self._run("git", "-C", str(second), "commit", "-m", "Advance remote")
        self._run("git", "-C", str(second), "push", "origin", "main")

        result = self._preflight()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("remote origin reports", result.stderr)

    def test_missing_upstream_is_rejected(self) -> None:
        self._git("checkout", "-b", "local-only")

        result = self._preflight()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("configure one with git push --set-upstream", result.stderr)

    def test_detached_checkout_requires_explicit_ci_mode(self) -> None:
        self._git("checkout", "--detach")

        local = self._preflight()
        self.assertNotEqual(local.returncode, 0)
        self.assertIn("detached HEAD", local.stderr)

        ci = self._preflight("--allow-detached-ci-checkout")
        self.assertEqual(ci.returncode, 0, ci.stderr)
        self.assertIn("detached CI checkout", ci.stdout)

    def test_ignored_untracked_asset_cannot_be_stamped(self) -> None:
        (self.repo / ".gitignore").write_text("assets/private.png\n", encoding="utf-8")
        (self.repo / "post.md").write_text(
            "# Fixture post\n\n![Private](assets/private.png)\n",
            encoding="utf-8",
        )
        (self.repo / "assets" / "private.png").write_bytes(b"ignored asset\n")
        self._git("add", ".gitignore", "post.md")
        self._git("commit", "-m", "Reference ignored asset")
        self._git("push")

        result, output = self._build_textpack()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("every post and referenced asset must be tracked", result.stderr)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
