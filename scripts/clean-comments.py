#!/usr/bin/env python3
"""Clean up review comment sidecar files."""
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

def main():
    parser = argparse.ArgumentParser(description="Clean review comments")
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument("--all", action="store_true", help="Delete all sidecar files")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    modified = deleted = 0
    for root, _, files in os.walk(args.directory):
        for f in files:
            if not f.endswith(".review.json"):
                continue
            path = os.path.join(root, f)

            if args.all:
                if args.dry_run:
                    print(f"[DRY RUN] Would delete {path}")
                else:
                    os.remove(path)
                deleted += 1
                continue

            try:
                with open(path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError) as e:
                print(f"WARNING: {path}: {e}", file=sys.stderr)
                continue

            original_count = len(data.get("comments", []))
            data["comments"] = [c for c in data.get("comments", []) if not c.get("resolved")]

            if len(data["comments"]) == 0:
                if args.dry_run:
                    print(f"[DRY RUN] Would delete {path} (all {original_count} resolved)")
                else:
                    os.remove(path)
                deleted += 1
            elif len(data["comments"]) < original_count:
                if args.dry_run:
                    print(f"[DRY RUN] Would remove {original_count - len(data['comments'])} resolved from {path}")
                else:
                    atomic_write(path, data)
                modified += 1

    prefix = "[DRY RUN] " if args.dry_run else ""
    print(f"{prefix}Modified {modified} file(s), deleted {deleted} file(s)")

if __name__ == "__main__":
    main()
