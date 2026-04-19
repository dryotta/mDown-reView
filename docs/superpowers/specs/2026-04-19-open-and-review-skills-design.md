# mdownreview-open and mdownreview-review Skills — Design

## Problem

Two workflow gaps remain in the agent review skills:

1. **No way to launch the app** — agents can't open mDown reView for visual review
2. **No orchestrated workflow** — agents must manually sequence read → fix → respond → resolve → cleanup

## New Skills

### mdownreview-open

**Description:** Use to open the mDown reView desktop app on the current project folder for visual review of comments

**CLI:** `python scripts/mdownreview.py open [path]`

- Defaults to current directory
- Searches for the installed app binary in this order:
  1. **Windows:** `%LOCALAPPDATA%\Programs\mDown reView\mDown reView.exe`
  2. **macOS:** `/Applications/mDown reView.app/Contents/MacOS/mDown reView`
  3. **PATH fallback:** `mDown reView` or `mdown-review` on system PATH
- Launches the app as a background process (does not block the agent)
- Passes the target path as a CLI argument to open the folder
- Exit 0 on successful launch, exit 1 if binary not found (with helpful error listing searched locations)

**Implementation:** New `open` subcommand in `scripts/mdownreview.py` using `subprocess.Popen` (detached).

### mdownreview-review

**Description:** Use when .review.json sidecar files exist alongside source files — orchestrates the full review cycle: read comments, fix code, respond, resolve, and clean up

**Implementation:** Pure SKILL.md workflow guide (no new Python code). Instructs the agent step by step:

1. **Read** — `python scripts/mdownreview.py read --format json` to get all unresolved comments
2. **Process comments grouped by file:**
   - Read the source file
   - Understand each comment in context
   - Fix the code to address the review feedback
   - Respond: `python scripts/mdownreview.py respond <file> <id> "<what was done>"`
   - Resolve: `python scripts/mdownreview.py resolve <file> <id>`
3. **Cleanup** — `python scripts/mdownreview.py cleanup` to remove fully-resolved sidecars
4. **Summary** — report: files changed, comments addressed, any that couldn't be resolved

**Key workflow guidance:**
- Use `--format json` for structured parsing
- Group comments by file (read file once, address all its comments)
- Commit changes per-file or per logical group, not per-comment
- Process all unresolved comments in sequence
- If a comment is ambiguous or can't be addressed, respond explaining why but still resolve it

## File Structure

```
skills/                                ← marketplace (new additions)
  mdownreview-open/SKILL.md
  mdownreview-review/SKILL.md

scripts/
  mdownreview.py                       ← add `open` subcommand
  test_mdownreview.py                  ← add tests for `open`
```

## Changes to Existing Files

- `scripts/mdownreview.py` — add `open` subcommand with app-finder logic
- `scripts/test_mdownreview.py` — add tests for `open` (mock subprocess)
- `.claude-plugin/plugin.json` — bump version (add 2 skills)
- `README.md` — add open and review to skills table
- `site/index.html` — update skill count mention

## Non-Goals

- No app download/install — just find and launch
- No waiting for the app to close — fire and forget
- No review workflow state persistence — the SKILL.md is a one-shot guide
