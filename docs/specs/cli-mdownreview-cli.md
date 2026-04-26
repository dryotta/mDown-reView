# Behavioral Spec — `mdownreview-cli`

> Canonical behaviour of the `mdownreview-cli` binary. The user-facing summary
> and source-of-truth tables for flags live in
> [`docs/features/cli-and-associations.md`](../features/cli-and-associations.md);
> this spec adds **Given / When / Then** scenarios for verification and
> regression coverage. Implementation lives in `src-tauri/src/bin/cli.rs` with
> shared path logic in `src-tauri/src/core/paths.rs`.

## Scope

- Subcommands covered: `read`, `respond`, `cleanup`.
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
  - header `[<id>] line N [<type>] (<severity>) <author> · <ISO timestamp>`,
  - the comment text,
  - a `quoted: "<selected_text>"` line (when `anchor.selected_text` is set),
  - each response indented one level under the original.
- `[RESOLVED]` is prefixed only when `--include-resolved` is set AND
  `resolved=true`.

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

## Coverage

Every scenario above is exercised by `src-tauri/tests/cli_integration.rs`
(integration) and `src-tauri/src/core/paths.rs` (`#[cfg(test)] mod tests`)
for the path-resolution primitives.
