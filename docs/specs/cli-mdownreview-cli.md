# Behavioral Spec — `mdownreview-cli`

> Canonical behaviour of the `mdownreview-cli` binary. The user-facing summary
> and source-of-truth tables for flags live in
> [`docs/features/cli-and-associations.md`](../features/cli-and-associations.md);
> this spec adds **Given / When / Then** scenarios for verification and
> regression coverage. Implementation lives in `src-tauri/src/bin/cli.rs` with
> shared path logic in `src-tauri/src/core/paths.rs`.

## Scope

- Subcommands covered: `read`, `respond`, `cleanup`, `analyze-log`.
- The legacy `resolve` subcommand was removed in #36; it is now an
  unrecognized-subcommand error (covered below).
- The legacy `--all` flag on `read` was renamed to `--include-resolved`; the
  old name is rejected.

## Path-resolution rules (apply to every flag/positional accepting a path)

1. **Absolute** input paths are used verbatim. `--folder` is ignored for them.
2. **Relative** input paths are resolved against `--folder` when supplied,
   else against the current working directory.
3. Source-vs-sidecar **auto-detection** runs *after* (1)+(2):
   - Inputs ending in `.review.yaml` / `.review.json` are treated as sidecars.
   - Otherwise the CLI probes `<resolved>.review.yaml` then
     `<resolved>.review.json` and uses whichever exists.
   - When both exist, `.yaml` wins.
   - When neither exists for a single-file operation that requires one, the
     CLI exits non-zero with `error: sidecar not found for '<input>' …`.
4. The same `core::paths::resolve_path` / `core::paths::resolve_sidecar`
   helpers are used by the GUI launcher (see
   [`cli-file-open.md`](./cli-file-open.md)). Behaviour MUST be identical
   across both binaries.

## Exit codes

| Exit | Meaning |
|---|---|
| `0` | Success. |
| `1` | Operational failure (I/O, sidecar parse error, missing sidecar in single-file mode, no comments to act on). |
| `2` | clap usage error (unknown flag/subcommand, missing required arg, mutually-exclusive args, `--response`/`--resolve` both omitted on `respond`). |

## Help / discoverability

### Scenario: top-level `--help` lists every subcommand and its flags

- **Given** the CLI is invoked as `mdownreview-cli --help`.
- **When** clap finishes printing the standard top-level help.
- **Then** an appendix is appended listing each subcommand and its long help
  (every flag with description) so a single invocation surfaces the full
  surface area without drilling in.
- **Coverage:** `src-tauri/tests/cli_integration.rs` (`top_level_help_*`).

### Scenario: per-subcommand `<cmd> --help` is unchanged

- **Given** `mdownreview-cli read --help`.
- **Then** standard clap long help for `read` is printed (no extra appendix).

## `read`

### Scenario: `--json` is a shortcut for `--format json`

- **Given** a folder with one sidecar.
- **When** the user runs `read --json` and `read --format json`.
- **Then** stdout is byte-identical for the two invocations.

### Scenario: `--file <relative>` with `--folder`

- **Given** `--folder /proj` and a sidecar at `/proj/sub/foo.md.review.yaml`.
- **When** the user runs `read --folder /proj --file sub/foo.md`.
- **Then** the CLI resolves `sub/foo.md` against `/proj`, auto-detects the
  `.review.yaml`, and prints comments only for that source file.

### Scenario: `--file <absolute>` ignores `--folder`

- **Given** `--folder /proj` and an absolute path under a different root.
- **When** `read --folder /proj --file /other/abs/file.md`.
- **Then** the absolute path is used as-is; `--folder` is not joined.

### Scenario: `--file` with no matching sidecar

- **Given** `--file path/with/no/sidecar.md`.
- **When** `read --file …` is invoked.
- **Then** the CLI exits non-zero with a message identifying the missing
  sidecar (and the search root, if `--folder` was used).

### Scenario: JSON envelope shape

- **Given** any sidecar with at least one matching comment.
- **Then** the JSON output (per review file) is:

```json
{
  "reviewFile": { "relative": "...", "absolute": "..." },
  "sourceFile": { "relative": "...", "absolute": "..." },
  "comments":   [ /* full MrsfComment objects with anchor, responses, etc. */ ]
}
```

- Single-file mode (`--file`) emits one envelope; folder-scan mode emits an
  array of envelopes.
- Unknown sidecar fields are preserved (raw YAML→JSON).

### Scenario: text output verbosity

- **Given** a sidecar with one comment that has selected text, an author, a
  timestamp, and one response.
- **When** `read` runs with the default text format.
- **Then** the per-comment block contains:
  - header `[<id>] <position> [<type>] (<severity>) <author> · <ISO timestamp>`
    where `<position>` is `line N` for line-anchored comments and
    `file-level` for comments with `anchor_kind: "file"` (MRSF §6/§7),
  - the comment text,
  - a `quoted: "<selected_text>"` line (when `anchor.selected_text` is set),
  - each response indented one level under the original.
- `[RESOLVED]` is prefixed only when `--include-resolved` is set AND
  `resolved=true`.

### Scenario: file-level (`anchor_kind: "file"`) comments do not require the source file

- **Given** a sidecar (`<source>.review.yaml`) whose comments all have
  `anchor_kind: "file"`. The `<source>` file MAY be missing, binary
  (e.g. `.png`, `.mp3`), or otherwise non-UTF-8.
- **When** `read` runs against that folder or single file.
- **Then** the CLI exits `0`, never opens `<source>`, and prints each
  unresolved comment with `<position> = file-level` (text format) or with
  the original `anchor_kind: "file"` field preserved (JSON format).
- **And** unrelated comments in the same scan keep their existing `line N`
  position.

### Scenario: `--include-resolved` toggles resolved entries

- **Given** a sidecar mixing resolved and unresolved comments.
- **When** `read` is run without `--include-resolved`, only unresolved
  comments appear; with `--include-resolved`, both appear and the resolved
  ones carry the `[RESOLVED]` prefix.

### Scenario: `--all` is removed (clean break, pre-1.0)

- **Given** any invocation containing `--all`.
- **Then** clap exits `2` with `unexpected argument '--all'`.

## `respond`

### Scenario: `--resolve` alone marks resolved without a response

- **Given** an unresolved comment `c1` in a sidecar.
- **When** `respond <file> c1 --resolve`.
- **Then** the sidecar is patched: `comments[c1].resolved = true`; no new
  response is appended.

### Scenario: `--response` + `--resolve` is atomic

- **When** `respond <file> c1 --response "fixed in commit abc" --resolve`.
- **Then** a single `patch_comment` call appends the response **and** flips
  `resolved` to `true` in the same write.

### Scenario: neither `--response` nor `--resolve`

- **When** `respond <file> c1` is invoked without either flag.
- **Then** clap exits `2` with `MissingRequiredArgument` (the message
  identifies that one of `--response`/`--resolve` is required).

### Scenario: `--folder` resolves the relative file argument

- **Given** `--folder /proj` and `/proj/foo.md.review.yaml`.
- **When** `respond --folder /proj foo.md c1 --resolve`.
- **Then** `foo.md` resolves under `/proj` and the sidecar is patched.

### Scenario: positional file accepts a source path (auto-detect)

- **Given** `/proj/foo.md` whose sidecar lives at `/proj/foo.md.review.yaml`.
- **When** `respond foo.md c1 --resolve` is run from `/proj`.
- **Then** the CLI probes `foo.md.review.yaml` and patches it.

### Scenario: positional file accepts a sidecar path verbatim

- **When** `respond foo.md.review.yaml c1 --resolve`.
- **Then** the path is used as-is (no probing).

### Scenario: positional file with no matching sidecar

- **When** `respond does/not/exist.md c1 --resolve`.
- **Then** the CLI exits non-zero with `error: sidecar not found for …`.

## `resolve` subcommand removal

### Scenario: legacy `resolve` rejected

- **When** `mdownreview-cli resolve <anything>`.
- **Then** clap exits `2` with `unrecognized subcommand 'resolve'`.

## `cleanup`

### Scenario: `--include-unresolved` deletes sidecars with open comments

- **Given** a folder with `a.review.yaml` (all resolved) and `b.review.yaml`
  (some unresolved).
- **When** `cleanup --include-unresolved`.
- **Then** both sidecars are deleted. Empty sidecars (no comments at all) are
  still skipped (matches existing behaviour).

### Scenario: `--include-unresolved --dry-run`

- **Given** the same folder.
- **When** `cleanup --include-unresolved --dry-run`.
- **Then** stdout lists every sidecar that would be deleted; the filesystem
  is unchanged.

### Scenario: default (no flag) keeps unresolved sidecars

- **When** `cleanup` is run without `--include-unresolved`.
- **Then** only fully-resolved sidecars are deleted.

## Path-resolution conformance (cross-cut)

### Scenario: absolute input bypasses `--folder` everywhere

- **Given** `--folder /proj` and any flag/positional that takes a path.
- **When** an absolute path is supplied.
- **Then** the absolute path is used verbatim regardless of `--folder`.

### Scenario: relative input falls back to cwd when `--folder` is omitted

- **When** any path-accepting flag receives a relative path and `--folder` is
  not set.
- **Then** the path is resolved against the process cwd.

## `analyze-log`

> Issue #265 / PR4. Aggregates the `[ipc]` and `[startup]` schemas
> shipped in PR3 (canonical schema reference: [`docs/observability.md`](../observability.md))
> into a startup-phase timeline and a per-command IPC distribution
> table. Pure consumer of the rotating log file — never writes back.

### Default log-path resolution

When neither `<path>` nor `--stdin` is supplied, the CLI computes the
runtime's standard rotating-log location and reads it. Mirrors
`tauri::path::PathResolver::app_log_dir` (verified against
tauri-2.10.3) using the `dirs` crate so the CLI can run without a
Tauri `AppHandle`:

| Platform | Path |
|---|---|
| Linux   | `$XDG_DATA_HOME/com.mdownreview.desktop/logs/mdownreview.log` |
| macOS   | `$HOME/Library/Logs/com.mdownreview.desktop/mdownreview.log` |
| Windows | `%LOCALAPPDATA%\com.mdownreview.desktop\logs\mdownreview.log` |

Non-existent file → exit `1` with `error: opening <path>: …`.

### Scenario: positional `<path>` reads that file

- **Given** a log file at `/tmp/mine.log`.
- **When** `analyze-log /tmp/mine.log`.
- **Then** the CLI parses that file and prints the text report; exit `0`.

### Scenario: `--stdin` reads from stdin

- **When** `cat /tmp/mine.log | analyze-log --stdin`.
- **Then** the CLI parses stdin and emits the same report.

### Scenario: `--stdin` and `<path>` are mutually exclusive

- **When** `analyze-log --stdin /tmp/mine.log`.
- **Then** clap exits `2` with a "cannot be used with" / "conflicts" message.

### Scenario: `--json` emits the documented schema

- **When** `analyze-log <path> --json`.
- **Then** stdout is a single pretty-printed JSON object:

```json
{
  "schema_version": 1,
  "startup_phases": [
    { "phase": "app-init", "t_ms": 0 },
    { "phase": "theme-applied", "t_ms": 12 },
    { "phase": "webview-ready", "t_ms": 142 }
  ],
  "ipc_commands": [
    {
      "name": "read_text_file",
      "count": 150,
      "p50_us": 1234,
      "p95_us": 3400,
      "p99_us": 8100,
      "total_us": 220123
    }
  ]
}
```

- `schema_version` starts at `1`; bumped on incompatible shape changes.
- `startup_phases` are sorted ascending by `t_ms`.
- `ipc_commands` are sorted descending by `total_us` (most-expensive
  first), tied entries ordered by name.
- Percentiles use **nearest-rank** ordering: index =
  `ceil(p/100 * N) - 1` (zero-indexed), clamped to the slice
  endpoints. No interpolation. Single-sample commands return that
  sample for every percentile.

### Scenario: text output has consistent column widths

- **When** `analyze-log <path>` (no `--json`).
- **Then** the report has two sections — `Startup phase timeline` and
  `IPC commands`. Phase names and command names are left-padded to
  the longest entry in their column; numeric columns are right-aligned.

### Scenario: malformed lines are silently skipped

- **Given** a log file containing a mix of valid `[ipc]`/`[startup]`
  lines and unrelated lines (timestamps + log messages from other
  targets, garbage prefixes, malformed key=value pairs, truncated
  trailing line).
- **When** `analyze-log <path>` runs.
- **Then** every well-formed line is parsed; every other line is
  silently dropped; exit `0`. The parser anchors on the substrings
  `[ipc]` / `[startup]` (NOT on column positions) so any prefix the
  `tauri-plugin-log` formatter prepends is naturally tolerated.

### Scenario: empty log produces clean output

- **Given** an empty log file.
- **When** `analyze-log <path>`.
- **Then** the report shows `(no [startup] events found)` and
  `(no [ipc] events found)` placeholders; exit `0`.

### Scenario: duplicate phases — first observation wins

- **Given** a log spanning two process runs (so `[startup] phase=app-init`
  appears twice).
- **Then** the report shows only the **first** `t_ms` for each phase.
  Matches the recorder's `seen` set semantics on the emitter side.

### Scenario: `--phase-budget <phase>=<ms>` enforces a per-phase ceiling

- **Given** the fixture `frontend-mounted` t_ms = 387.
- **When** `analyze-log <path> --phase-budget frontend-mounted=10`.
- **Then** the CLI prints the report to stdout, then prints
  `BUDGET BREACH: frontend-mounted t_ms=387 > budget=10` to stderr
  and exits `2`.

### Scenario: `--phase-budget` repeatable

- **When** the flag is supplied multiple times.
- **Then** every breach is reported (one stderr line per breach)
  before the CLI exits `2`. A run that has SOME breaches and SOME
  passing budgets still exits non-zero.

### Scenario: `--phase-budget` against a missing phase

- **Given** a log that does NOT contain the named phase (and the log
  is non-empty).
- **Then** the missing phase is reported as
  `BUDGET BREACH: <phase> missing (budget=<ms>)` and exit `2`.

### Scenario: `--phase-budget` against an empty log passes vacuously

- **Given** an empty log file.
- **When** `analyze-log <path> --phase-budget anything=1`.
- **Then** the budget check is skipped (no observations to compare
  against); exit `0`. Prevents a CI run against a freshly-rotated
  log from failing on every phase.

### Scenario: malformed `--phase-budget` value

- **When** `--phase-budget foo` (no `=`) or `--phase-budget foo=abc`
  (non-integer ms).
- **Then** the CLI exits `2` with
  `error: invalid --phase-budget "<arg>": expected <phase>=<ms>`.

### Exit-code summary for `analyze-log`

| Exit | Meaning |
|---|---|
| `0` | Success: report rendered, no budget breaches. |
| `1` | Operational failure (cannot open log file, I/O error reading the file). |
| `2` | clap usage error OR `--phase-budget` breach OR malformed `--phase-budget` value. |

## Coverage

Every scenario above is exercised by `src-tauri/tests/cli_integration.rs`
(integration), `src-tauri/tests/cli_analyze_log.rs` (analyze-log
integration), `src-tauri/src/cli/analyze_log.rs` (`#[cfg(test)] mod
tests` — pure parser / percentile / budget evaluator), and
`src-tauri/src/core/paths.rs` (`#[cfg(test)] mod tests` for the
path-resolution primitives).
