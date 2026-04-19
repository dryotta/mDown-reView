#!/usr/bin/env python3
"""Add responses to review comments."""
import argparse, json, os, sys, tempfile
from datetime import datetime, timezone

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

def respond(sidecar_path, comment_id, author, text):
    with open(sidecar_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    found = False
    for c in data.get("comments", []):
        if c["id"] == comment_id:
            if "responses" not in c: c["responses"] = []
            c["responses"].append({
                "author": author, "text": text,
                "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            })
            found = True
            break
    if not found:
        print(f"ERROR: comment {comment_id} not found in {sidecar_path}", file=sys.stderr)
        return False
    atomic_write(sidecar_path, data)
    return True

def main():
    parser = argparse.ArgumentParser(description="Respond to review comments")
    parser.add_argument("--file", required=True, help="Path to reviewed file")
    parser.add_argument("--id", help="Comment ID to respond to")
    parser.add_argument("--author", required=True)
    parser.add_argument("--text", help="Response text")
    parser.add_argument("--from-json", help="JSON file with batch responses")
    args = parser.parse_args()

    sidecar = args.file + ".review.json"
    if not os.path.exists(sidecar):
        print(f"ERROR: {sidecar} not found", file=sys.stderr)
        sys.exit(1)

    if args.from_json:
        with open(args.from_json, "r") as f:
            responses = json.load(f)
        ok = all(respond(sidecar, r["id"], args.author, r["text"]) for r in responses)
        sys.exit(0 if ok else 1)
    elif args.id and args.text:
        ok = respond(sidecar, args.id, args.author, args.text)
        sys.exit(0 if ok else 1)
    else:
        parser.error("Provide --id and --text, or --from-json")

if __name__ == "__main__":
    main()
