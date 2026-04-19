#!/usr/bin/env python3
"""Tests for mdownreview.py CLI."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from io import StringIO

# Ensure the scripts directory is importable
sys.path.insert(0, os.path.dirname(__file__))

import mdownreview


def make_review(comments, version=3):
    """Build a review sidecar dict."""
    return {"version": version, "comments": comments}


def make_comment(id_, text="Fix this", line=10, resolved=False, responses=None):
    """Build a single comment dict."""
    c = {
        "id": id_,
        "anchorType": "line",
        "lineHash": "abcd1234",
        "lineNumber": line,
        "text": text,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "resolved": resolved,
    }
    if responses is not None:
        c["responses"] = responses
    return c


class TempDirMixin:
    """Mixin that creates a temp directory for each test."""

    def setUp(self):
        self._tmpdir_obj = tempfile.TemporaryDirectory()
        self.tmpdir = self._tmpdir_obj.name

    def tearDown(self):
        self._tmpdir_obj.cleanup()

    def write_review(self, relpath, data):
        full = os.path.join(self.tmpdir, relpath)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return full

    def read_review(self, path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)


# ===== read =====

class TestReadText(TempDirMixin, unittest.TestCase):
    """read subcommand — text format."""

    def test_unresolved_only(self):
        self.write_review("app.tsx.review.json", make_review([
            make_comment("c1", "Fix null", line=15),
            make_comment("c2", "OK", line=20, resolved=True),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir])
        sys.stdout = old_stdout
        output = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("app.tsx", output)
        self.assertIn("[c1]", output)
        self.assertIn("Fix null", output)
        self.assertNotIn("[c2]", output)
        self.assertIn("1 unresolved", output)

    def test_all_flag(self):
        self.write_review("app.tsx.review.json", make_review([
            make_comment("c1", "Fix null", line=15),
            make_comment("c2", "OK", line=20, resolved=True),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir, "--all"])
        sys.stdout = old_stdout
        output = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("[c1]", output)
        self.assertIn("[c2]", output)
        self.assertIn("2 comments", output)

    def test_empty_dir(self):
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue(), "")

    def test_nested_dirs(self):
        self.write_review(os.path.join("sub", "deep", "x.md.review.json"), make_review([
            make_comment("n1", "Nested comment", line=1),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir])
        sys.stdout = old_stdout
        output = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("[n1]", output)
        self.assertIn("x.md", output)


class TestReadJson(TempDirMixin, unittest.TestCase):
    """read subcommand — JSON format."""

    def test_json_unresolved(self):
        self.write_review("app.tsx.review.json", make_review([
            make_comment("c1", "Fix", line=15),
            make_comment("c2", "OK", line=20, resolved=True),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir, "--format", "json"])
        sys.stdout = old_stdout
        data = json.loads(buf.getvalue())
        self.assertEqual(rc, 0)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["sourceFile"], "app.tsx")
        self.assertEqual(len(data[0]["comments"]), 1)
        self.assertEqual(data[0]["comments"][0]["id"], "c1")

    def test_json_all(self):
        self.write_review("app.tsx.review.json", make_review([
            make_comment("c1", "Fix", line=15),
            make_comment("c2", "OK", line=20, resolved=True),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir, "--format", "json", "--all"])
        sys.stdout = old_stdout
        data = json.loads(buf.getvalue())
        self.assertEqual(rc, 0)
        self.assertEqual(len(data[0]["comments"]), 2)

    def test_json_empty_dir(self):
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir, "--format", "json"])
        sys.stdout = old_stdout
        data = json.loads(buf.getvalue())
        self.assertEqual(rc, 0)
        self.assertEqual(data, [])

    def test_review_file_relative_path(self):
        self.write_review(os.path.join("sub", "x.md.review.json"), make_review([
            make_comment("r1", "Check", line=5),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["read", self.tmpdir, "--format", "json"])
        sys.stdout = old_stdout
        data = json.loads(buf.getvalue())
        self.assertEqual(rc, 0)
        # reviewFile should be a relative path
        self.assertIn("sub", data[0]["reviewFile"])


# ===== respond =====

class TestRespond(TempDirMixin, unittest.TestCase):

    def test_adds_response(self):
        fpath = self.write_review("app.tsx.review.json", make_review([
            make_comment("c1", "Fix this"),
        ]))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        rc = mdownreview.main(["respond", fpath, "c1", "Done"])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        data = self.read_review(fpath)
        resps = data["comments"][0]["responses"]
        self.assertEqual(len(resps), 1)
        self.assertEqual(resps[0]["author"], "agent")
        self.assertEqual(resps[0]["text"], "Done")
        self.assertIn("createdAt", resps[0])

    def test_preserves_version(self):
        fpath = self.write_review("a.md.review.json", make_review(
            [make_comment("c1", "Fix")], version=2
        ))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        mdownreview.main(["respond", fpath, "c1", "OK"])
        sys.stdout = old_stdout
        data = self.read_review(fpath)
        self.assertEqual(data["version"], 2)

    def test_unknown_id_fails(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix"),
        ]))
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = StringIO()
        sys.stderr = StringIO()
        rc = mdownreview.main(["respond", fpath, "nonexistent", "text"])
        sys.stdout, sys.stderr = old_stdout, old_stderr
        self.assertEqual(rc, 1)

    def test_appends_to_existing_responses(self):
        existing = [{"author": "human", "text": "Hmm", "createdAt": "2026-01-01T00:00:00.000Z"}]
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix", responses=existing),
        ]))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        mdownreview.main(["respond", fpath, "c1", "Done"])
        sys.stdout = old_stdout
        data = self.read_review(fpath)
        resps = data["comments"][0]["responses"]
        self.assertEqual(len(resps), 2)
        self.assertEqual(resps[0]["author"], "human")
        self.assertEqual(resps[1]["author"], "agent")

    def test_missing_file_fails(self):
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = StringIO()
        sys.stderr = StringIO()
        rc = mdownreview.main(["respond", os.path.join(self.tmpdir, "nope.review.json"), "c1", "x"])
        sys.stdout, sys.stderr = old_stdout, old_stderr
        self.assertEqual(rc, 1)


# ===== resolve =====

class TestResolve(TempDirMixin, unittest.TestCase):

    def test_single_comment(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix"),
            make_comment("c2", "Also fix"),
        ]))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        rc = mdownreview.main(["resolve", fpath, "c1"])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        data = self.read_review(fpath)
        self.assertTrue(data["comments"][0]["resolved"])
        self.assertFalse(data["comments"][1]["resolved"])

    def test_multiple_comments(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix"),
            make_comment("c2", "Also"),
            make_comment("c3", "And this"),
        ]))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        rc = mdownreview.main(["resolve", fpath, "c1", "c3"])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        data = self.read_review(fpath)
        self.assertTrue(data["comments"][0]["resolved"])
        self.assertFalse(data["comments"][1]["resolved"])
        self.assertTrue(data["comments"][2]["resolved"])

    def test_all_flag(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix"),
            make_comment("c2", "Also"),
        ]))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        rc = mdownreview.main(["resolve", fpath, "--all"])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        data = self.read_review(fpath)
        self.assertTrue(all(c["resolved"] for c in data["comments"]))

    def test_unknown_id_fails(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix"),
        ]))
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = StringIO()
        sys.stderr = StringIO()
        rc = mdownreview.main(["resolve", fpath, "nonexistent"])
        sys.stdout, sys.stderr = old_stdout, old_stderr
        self.assertEqual(rc, 1)

    def test_preserves_version(self):
        fpath = self.write_review("a.md.review.json", make_review(
            [make_comment("c1", "Fix")], version=1
        ))
        old_stdout = sys.stdout
        sys.stdout = StringIO()
        mdownreview.main(["resolve", fpath, "c1"])
        sys.stdout = old_stdout
        data = self.read_review(fpath)
        self.assertEqual(data["version"], 1)

    def test_no_ids_no_all_fails(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix"),
        ]))
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = StringIO()
        sys.stderr = StringIO()
        rc = mdownreview.main(["resolve", fpath])
        sys.stdout, sys.stderr = old_stdout, old_stderr
        self.assertEqual(rc, 1)


# ===== cleanup =====

class TestCleanup(TempDirMixin, unittest.TestCase):

    def test_deletes_fully_resolved(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix", resolved=True),
            make_comment("c2", "Also", resolved=True),
        ]))
        # Keep one with unresolved
        keep = self.write_review("b.md.review.json", make_review([
            make_comment("c3", "Keep", resolved=False),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["cleanup", self.tmpdir])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(fpath))
        self.assertTrue(os.path.exists(keep))
        self.assertIn("1 file(s) deleted", buf.getvalue())

    def test_dry_run(self):
        fpath = self.write_review("a.md.review.json", make_review([
            make_comment("c1", "Fix", resolved=True),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["cleanup", self.tmpdir, "--dry-run"])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(fpath))
        self.assertIn("would delete", buf.getvalue())

    def test_empty_dir(self):
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["cleanup", self.tmpdir])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        self.assertIn("0 file(s)", buf.getvalue())

    def test_reports_count(self):
        self.write_review("a.md.review.json", make_review([
            make_comment("c1", resolved=True),
        ]))
        self.write_review("b.md.review.json", make_review([
            make_comment("c2", resolved=True),
        ]))
        self.write_review("c.md.review.json", make_review([
            make_comment("c3", resolved=False),
        ]))
        old_stdout = sys.stdout
        sys.stdout = buf = StringIO()
        rc = mdownreview.main(["cleanup", self.tmpdir])
        sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        self.assertIn("2 file(s) deleted", buf.getvalue())


# ===== helpers =====

class TestHelpers(unittest.TestCase):

    def test_source_file_for(self):
        self.assertEqual(mdownreview.source_file_for("app.tsx.review.json"), "app.tsx")
        self.assertEqual(mdownreview.source_file_for("readme.md.review.json"), "readme.md")

    def test_iso_now_format(self):
        ts = mdownreview.iso_now()
        self.assertTrue(ts.endswith("Z"))
        self.assertIn("T", ts)

    def test_no_subcommand_exits_1(self):
        old_stdout, old_stderr = sys.stdout, sys.stderr
        sys.stdout = StringIO()
        sys.stderr = StringIO()
        rc = mdownreview.main([])
        sys.stdout, sys.stderr = old_stdout, old_stderr
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()
