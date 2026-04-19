#!/usr/bin/env python3
"""CLI for working with mDown reView .review.json sidecar files.

Subcommands:
  read     — show review comments from sidecar files
  respond  — add a response to a comment
  resolve  — mark comments as resolved
  cleanup  — delete fully-resolved sidecar files
"""

import argparse
import datetime
import json
import os
import sys
import tempfile
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def find_review_files(root: str) -> list[str]:
    """Recursively find all *.review.json files under *root*."""
    results: list[str] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in sorted(filenames):
            if fn.endswith(".review.json"):
                results.append(os.path.join(dirpath, fn))
    results.sort()
    return results


def load_review(path: str) -> dict:
    """Load and return parsed JSON from a review sidecar file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_review(path: str, data: dict) -> None:
    """Atomically write *data* as JSON to *path*.

    Uses a temporary file in the same directory followed by ``os.replace``
    so the write is atomic on both Windows and POSIX.
    """
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        # Clean up the temp file on any failure
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def source_file_for(review_path: str) -> str:
    """Derive the source filename by stripping ``.review.json``."""
    base = os.path.basename(review_path)
    if base.endswith(".review.json"):
        return base[: -len(".review.json")]
    return base


def iso_now() -> str:
    """Return the current UTC time as an ISO-8601 string with ``Z`` suffix."""
    return datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.%f"
    )[:-3] + "Z"


# ---------------------------------------------------------------------------
# read
# ---------------------------------------------------------------------------

def cmd_read(args: argparse.Namespace) -> int:
    root = args.path or os.getcwd()
    show_all = args.all
    fmt = args.format

    files = find_review_files(root)
    output_entries: list[dict] = []

    for fpath in files:
        try:
            data = load_review(fpath)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"warning: skipping {fpath}: {exc}", file=sys.stderr)
            continue

        comments = data.get("comments", [])
        if not show_all:
            comments = [c for c in comments if not c.get("resolved", False)]
        if not comments:
            continue

        rel = os.path.relpath(fpath, root)
        source = source_file_for(fpath)
        output_entries.append({
            "reviewFile": rel,
            "sourceFile": source,
            "comments": comments,
        })

    if fmt == "json":
        json.dump(output_entries, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        for entry in output_entries:
            n = len(entry["comments"])
            label = "comments" if show_all else "unresolved comments"
            print(f"\u2500\u2500 {entry['sourceFile']} ({n} {label}) \u2500\u2500")
            for c in entry["comments"]:
                line = c.get("lineNumber", "?")
                print(f"  [{c['id']}] line {line}: {c['text']}")

    return 0


# ---------------------------------------------------------------------------
# respond
# ---------------------------------------------------------------------------

def cmd_respond(args: argparse.Namespace) -> int:
    fpath = args.file
    comment_id = args.comment_id
    text = args.text

    if not os.path.isfile(fpath):
        print(f"error: file not found: {fpath}", file=sys.stderr)
        return 1

    data = load_review(fpath)
    version = data.get("version", 3)

    found = False
    for c in data.get("comments", []):
        if c["id"] == comment_id:
            responses = c.setdefault("responses", [])
            responses.append({
                "author": "agent",
                "text": text,
                "createdAt": iso_now(),
            })
            found = True
            break

    if not found:
        print(f"error: comment '{comment_id}' not found in {fpath}", file=sys.stderr)
        return 1

    data["version"] = version
    save_review(fpath, data)
    print(f"Responded to {comment_id}")
    return 0


# ---------------------------------------------------------------------------
# resolve
# ---------------------------------------------------------------------------

def cmd_resolve(args: argparse.Namespace) -> int:
    fpath = args.file
    resolve_all = args.all
    comment_ids: list[str] = args.comment_ids or []

    if not resolve_all and not comment_ids:
        print("error: provide comment IDs or --all", file=sys.stderr)
        return 1

    if not os.path.isfile(fpath):
        print(f"error: file not found: {fpath}", file=sys.stderr)
        return 1

    data = load_review(fpath)
    version = data.get("version", 3)
    comments = data.get("comments", [])

    if resolve_all:
        count = 0
        for c in comments:
            if not c.get("resolved", False):
                c["resolved"] = True
                count += 1
        data["version"] = version
        save_review(fpath, data)
        print(f"Resolved {count} comment(s)")
        return 0

    # Resolve specific IDs
    ids_found: set[str] = set()
    for c in comments:
        if c["id"] in comment_ids:
            c["resolved"] = True
            ids_found.add(c["id"])

    missing = set(comment_ids) - ids_found
    if missing:
        print(
            f"error: comment(s) not found: {', '.join(sorted(missing))}",
            file=sys.stderr,
        )
        return 1

    data["version"] = version
    save_review(fpath, data)
    print(f"Resolved {len(ids_found)} comment(s)")
    return 0


# ---------------------------------------------------------------------------
# cleanup
# ---------------------------------------------------------------------------

def cmd_cleanup(args: argparse.Namespace) -> int:
    root = args.path or os.getcwd()
    dry_run = args.dry_run

    files = find_review_files(root)
    removed = 0

    for fpath in files:
        try:
            data = load_review(fpath)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"warning: skipping {fpath}: {exc}", file=sys.stderr)
            continue

        comments = data.get("comments", [])
        if not comments:
            continue
        if all(c.get("resolved", False) for c in comments):
            rel = os.path.relpath(fpath, root)
            if dry_run:
                print(f"would delete: {rel}")
            else:
                os.remove(fpath)
                print(f"deleted: {rel}")
            removed += 1

    action = "would delete" if dry_run else "deleted"
    print(f"{removed} file(s) {action}")
    return 0


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mdownreview",
        description="Work with mDown reView .review.json sidecar files.",
    )
    sub = parser.add_subparsers(dest="command")

    # read
    p_read = sub.add_parser("read", help="Show review comments")
    p_read.add_argument("path", nargs="?", default=None, help="Root directory (default: cwd)")
    p_read.add_argument("--format", choices=["json", "text"], default="text")
    p_read.add_argument("--all", action="store_true", help="Include resolved comments")
    p_read.set_defaults(func=cmd_read)

    # respond
    p_resp = sub.add_parser("respond", help="Add a response to a comment")
    p_resp.add_argument("file", help="Path to .review.json file")
    p_resp.add_argument("comment_id", help="Comment ID")
    p_resp.add_argument("text", help="Response text")
    p_resp.set_defaults(func=cmd_respond)

    # resolve
    p_res = sub.add_parser("resolve", help="Mark comments as resolved")
    p_res.add_argument("file", help="Path to .review.json file")
    p_res.add_argument("comment_ids", nargs="*", help="Comment IDs to resolve")
    p_res.add_argument("--all", action="store_true", help="Resolve all comments")
    p_res.set_defaults(func=cmd_resolve)

    # cleanup
    p_clean = sub.add_parser("cleanup", help="Delete fully-resolved sidecar files")
    p_clean.add_argument("path", nargs="?", default=None, help="Root directory (default: cwd)")
    p_clean.add_argument("--dry-run", action="store_true", help="Preview without deleting")
    p_clean.set_defaults(func=cmd_cleanup)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 1
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
