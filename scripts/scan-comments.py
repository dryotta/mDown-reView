#!/usr/bin/env python3
"""Scan .review.json sidecar files and display comments."""
import argparse, json, os, sys

def scan_directory(directory, status_filter=None, as_json=False):
    results = []
    for root, _, files in os.walk(directory):
        for f in sorted(files):
            if not f.endswith(".review.json"):
                continue
            sidecar_path = os.path.join(root, f)
            reviewed_file = sidecar_path[:-len(".review.json")]
            rel_path = os.path.relpath(reviewed_file, directory)
            try:
                with open(sidecar_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError) as e:
                print(f"WARNING: {sidecar_path}: {e}", file=sys.stderr)
                continue

            source_lines = []
            try:
                with open(reviewed_file, "r", encoding="utf-8") as fh:
                    source_lines = fh.read().splitlines()
            except OSError:
                pass

            for c in data.get("comments", []):
                anchor = c.get("anchorType", "block")
                line_num = c.get("lineNumber") or c.get("fallbackLine") or 1
                status = "resolved" if c.get("resolved") else "unresolved"
                if anchor == "block":
                    status = "orphaned"

                if status_filter and status != status_filter:
                    continue

                if anchor == "selection":
                    ref = c.get("selectedText", "")[:60]
                elif anchor == "line" and 1 <= line_num <= len(source_lines):
                    ref = source_lines[line_num - 1][:60]
                else:
                    ref = "<n/a>"

                comment_text = c.get("text", "").replace("\n", "\\n")

                if as_json:
                    results.append({
                        "file": rel_path, "line": line_num, "status": status,
                        "anchor": anchor, "reference": ref, "comment": c.get("text", ""),
                        "id": c.get("id"), "responses": c.get("responses", []),
                    })
                else:
                    results.append(f"{rel_path}\t{line_num}\t{status}\t{anchor}\t{ref}\t{comment_text}")

    return results

def main():
    parser = argparse.ArgumentParser(description="Scan review comments")
    parser.add_argument("directory", nargs="?", default=".")
    parser.add_argument("--unresolved", action="store_true")
    parser.add_argument("--resolved", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    status_filter = None
    if args.unresolved: status_filter = "unresolved"
    elif args.resolved: status_filter = "resolved"

    results = scan_directory(args.directory, status_filter, args.json)

    if args.json:
        print(json.dumps(results, indent=2))
    else:
        if results:
            print("FILE\tLINE\tSTATUS\tANCHOR\tREFERENCE\tCOMMENT")
        for r in results:
            print(r)

if __name__ == "__main__":
    main()
