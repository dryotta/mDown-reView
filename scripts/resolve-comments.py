#!/usr/bin/env python3
"""Resolve review comments."""
import argparse, json, os, sys, tempfile

def atomic_write(path, data):
    dir_name = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except:
        os.unlink(tmp)
        raise

def resolve_in_file(sidecar_path, ids=None, responded_by=None, all_comments=False, dry_run=False):
    try:
        with open(sidecar_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"WARNING: {sidecar_path}: {e}", file=sys.stderr)
        return 0

    count = 0
    for c in data.get("comments", []):
        if c.get("resolved"):
            continue
        should_resolve = False
        if all_comments:
            should_resolve = True
        elif ids and c["id"] in ids:
            should_resolve = True
        elif responded_by:
            for r in c.get("responses", []):
                if r.get("author") == responded_by:
                    should_resolve = True
                    break
        if should_resolve:
            if not dry_run:
                c["resolved"] = True
            count += 1

    if count > 0 and not dry_run:
        atomic_write(sidecar_path, data)
    return count

def main():
    parser = argparse.ArgumentParser(description="Resolve review comments")
    parser.add_argument("directory", nargs="?", default=None)
    parser.add_argument("--file", help="Specific file")
    parser.add_argument("--id", action="append", help="Comment IDs to resolve")
    parser.add_argument("--responded-by", help="Resolve comments responded to by author")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    total = 0
    if args.file:
        sidecar = args.file + ".review.json"
        total = resolve_in_file(sidecar, args.id, args.responded_by, args.all, args.dry_run)
    else:
        directory = args.directory or "."
        for root, _, files in os.walk(directory):
            for f in files:
                if f.endswith(".review.json"):
                    total += resolve_in_file(
                        os.path.join(root, f), args.id, args.responded_by, args.all, args.dry_run
                    )

    prefix = "[DRY RUN] " if args.dry_run else ""
    print(f"{prefix}Resolved {total} comment(s)")

if __name__ == "__main__":
    main()
