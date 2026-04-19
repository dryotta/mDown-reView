# Agent Skills for Review Comments — Design

## Problem

Coding agents (Claude, Copilot, Codex, etc.) working in repos that contain `.review.json` sidecar files from mDown reView have no way to read, respond to, resolve, or clean up those review comments. We need a set of lightweight, tool-agnostic skills and a CLI script that any agent can use.

## Approach

- **Four skills** prefixed `mdownreview-` (read, respond, resolve, cleanup)
- **One Python CLI** (`scripts/mdownreview.py`) with subcommands — zero external dependencies
- **This repo doubles as the marketplace** at `dryotta/mdownreview`
- Skills are minimal SKILL.md files that instruct the agent to call the Python script

## Skills

### mdownreview-read

**Description:** Use when `.review.json` sidecar files exist alongside source files — reads unresolved review comments for the agent to address

**CLI:** `python scripts/mdownreview.py read [path] [--format json|text] [--all]`

- Scans directory recursively for `*.review.json` files
- Default: shows unresolved comments only (use `--all` for everything)
- `--format text` (default): human-readable summary
- `--format json`: machine-parseable output for programmatic use
- Output per comment: id, source file, lineNumber, anchorType, text, resolved, responses

### mdownreview-respond

**Description:** Use after addressing a review comment from a `.review.json` sidecar file — records a response acknowledging the fix

**CLI:** `python scripts/mdownreview.py respond <review-json-file> <comment-id> <response-text>`

- Adds a `CommentResponse` to the comment's `responses` array
- Response: `{ "author": "agent", "text": "<response-text>", "createdAt": "<ISO timestamp>" }`
- Atomic write (temp file + os.replace)
- Preserves existing `version` field
- Exits 1 if comment-id not found

### mdownreview-resolve

**Description:** Use after responding to review comments from `.review.json` sidecar files — marks comments as resolved

**CLI:** `python scripts/mdownreview.py resolve <review-json-file> <comment-id> [comment-id...] [--all]`

- Sets `resolved: true` on specified comment(s)
- `--all` flag resolves every comment in the file
- Atomic write
- Exits 1 if any comment-id not found

### mdownreview-cleanup

**Description:** Use to clean up `.review.json` sidecar files after all review comments have been resolved

**CLI:** `python scripts/mdownreview.py cleanup [path] [--dry-run]`

- Scans directory recursively for `.review.json` files
- Deletes files where ALL comments are resolved
- `--dry-run`: lists files that would be deleted without deleting
- Reports actions taken to stdout

## Python CLI Design (`scripts/mdownreview.py`)

### Principles
- Zero dependencies — stdlib only (json, os, sys, argparse, datetime, tempfile, pathlib)
- Atomic writes via `tempfile.NamedTemporaryFile` + `os.replace`
- Preserves `version` field on write (defaults to 3 if missing)
- Exit code 0 on success, 1 on error
- Errors to stderr, output to stdout

### Sidecar Format (read/write)
```json
{
  "version": 3,
  "comments": [
    {
      "id": "ecv4rn81",
      "anchorType": "line",
      "lineHash": "811c9dc5",
      "lineNumber": 15,
      "text": "This needs a null check",
      "createdAt": "2026-04-19T20:46:00.241Z",
      "resolved": false,
      "responses": [
        {
          "author": "agent",
          "text": "Added null check at line 15",
          "createdAt": "2026-04-19T21:00:00.000Z"
        }
      ]
    }
  ]
}
```

### `read` Output Format (text)
```
── src/app.tsx (3 unresolved) ──────────
  [ecv4rn81] line 15: This needs a null check
  [q0fnhy9k] line 8: Missing error handling
  [sg9t6xz8] selection lines 27-29: Redundant logic

── src/utils.ts (1 unresolved) ─────────
  [abc12345] line 42: Consider memoizing this
```

### `read` Output Format (json)
```json
[
  {
    "reviewFile": "src/app.tsx.review.json",
    "sourceFile": "src/app.tsx",
    "comments": [
      {
        "id": "ecv4rn81",
        "anchorType": "line",
        "lineNumber": 15,
        "text": "This needs a null check",
        "resolved": false,
        "responses": []
      }
    ]
  }
]
```

## SKILL.md Pattern

Each skill is a minimal markdown file with YAML frontmatter:

```markdown
---
name: mdownreview-read
description: "Use when .review.json sidecar files exist alongside source files — reads unresolved review comments for the agent to address"
---

# Read Review Comments

Scan for `.review.json` sidecar files and display outstanding review comments.

## Usage

\`\`\`bash
python scripts/mdownreview.py read [path] [--format json|text] [--all]
\`\`\`

- Default: scans current directory recursively, shows only unresolved comments
- `--format json` for machine-parseable output
- `--all` to include resolved comments
- Each comment shows: id, file, line, anchor type, text, resolved status, responses
```

## File Structure

```
.claude/
  skills/
    mdownreview-read/SKILL.md
    mdownreview-respond/SKILL.md
    mdownreview-resolve/SKILL.md
    mdownreview-cleanup/SKILL.md
    publish-release/SKILL.md          ← existing, updated
.claude-plugin/
  marketplace.json                     ← NEW: marketplace catalog
  plugin.json                          ← NEW: plugin metadata
scripts/
  mdownreview.py                       ← NEW: Python CLI
```

## Marketplace Configuration

### `.claude-plugin/plugin.json`
```json
{
  "name": "mdownreview-skills",
  "description": "Skills for reading, responding to, resolving, and cleaning up .review.json sidecar comments",
  "version": "0.3.0",
  "author": {
    "name": "dryotta"
  },
  "homepage": "https://github.com/dryotta/mdownreview",
  "repository": "https://github.com/dryotta/mdownreview",
  "license": "MIT",
  "keywords": ["review", "comments", "sidecar", "markdown"]
}
```

### `.claude-plugin/marketplace.json`
```json
{
  "name": "mdownreview",
  "metadata": {
    "description": "Skills for working with .review.json sidecar comments",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "mdownreview-skills",
      "source": {
        "source": "url",
        "url": "https://github.com/dryotta/mdownreview.git"
      },
      "description": "Read, respond to, resolve, and clean up .review.json sidecar comments",
      "version": "0.3.0",
      "strict": true
    }
  ]
}
```

## Installation Instructions (for README/site)

### For agents working in this repo
Skills are automatically available — they live in `.claude/skills/`.

### For agents working in other repos

**Claude Code / Copilot CLI:**
```
/plugin marketplace add dryotta/mdownreview
/plugin install mdownreview-skills@mdownreview
```

**Manual:**
Clone and add `.claude/skills/` and `scripts/mdownreview.py` to your project.

## Documentation Updates

### README.md
Add a section "Agent Skills" after "Development" explaining:
- What `.review.json` sidecar files are
- Available skills and what they do
- How to install from the marketplace
- How to use the Python CLI directly

### site/index.html
Add a section about agent integration with install commands.

## Release Integration

The `publish-release` skill will be updated to also bump the version in:
- `.claude-plugin/marketplace.json` (the plugin version within the plugins array)
- `.claude-plugin/plugin.json` (the top-level version)

This keeps marketplace versions in sync with app releases.

## Non-Goals
- No MCP server — the Python CLI is sufficient
- No Tauri IPC dependency — scripts read/write files directly
- No database — sidecars are the source of truth
- No authentication or network calls
