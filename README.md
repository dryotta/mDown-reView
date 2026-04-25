# [mdownreview - Review AI Agent's work](https://dryotta.github.io/mdownreview)

> Markdown viewer and review app for Windows and Mac: Make inline comments for AI agents to fix.

[![CI](https://github.com/dryotta/mdownreview/actions/workflows/ci.yml/badge.svg)](https://github.com/dryotta/mdownreview/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/dryotta/mdownreview)](https://github.com/dryotta/mdownreview/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## How It Works

1. **Your AI agent writes a proposal**
2. **You review the proposal** (`/mdownreview:open`) — browse the file tree, read rendered markdown, and leave inline review comments
3. **You ask agent to read comments** (`/mdownreview:read`) — the agent scans all `.review.yaml` sidecars and lists every unresolved comment
4. **You ask agent to address the comments** (`/mdownreview:review`) — the agent reads comments, makes fixes, and marks them resolved
5. **You clean up** (`/mdownreview:cleanup`) — removes `.review.yaml` sidecar files once all comments are resolved

## Install

### macOS

**Script (recommended)** — handles Gatekeeper quarantine and adds the CLI to your PATH automatically:

```bash
curl -LsSf https://dryotta.github.io/mdownreview/install.sh | sh
```

> ⚠️ Pipes remote code into your shell — use manual download below if blocked by security policy.

**Manual download** — grab `mdownreview-x.x.x-macos-arm64.dmg` from the [Releases page](https://github.com/dryotta/mdownreview/releases/latest) and clear the Gatekeeper quarantine:

```bash
xattr -d com.apple.quarantine /Applications/mdownreview.app
```

### Windows

**Manual download (recommended)** — grab the matching `.zip` from the [Releases page](https://github.com/dryotta/mdownreview/releases/latest):

| Architecture | Filename |
|---|---|
| Windows x64 (Intel/AMD) | `mdownreview-x.x.x-windows-x64.zip` |
| Windows ARM64 | `mdownreview-x.x.x-windows-arm64.zip` |

Extract and run `mdownreview.exe`. SmartScreen may show "unrecognized app" — click "More info" → "Run anyway".

**Script** (alternative — uses PowerShell, may need execution policy bypass):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://dryotta.github.io/mdownreview/install.ps1 | iex"
```

### CLI Tool

The `mdownreview-cli` is a standalone command-line tool for working with review sidecars without the GUI. Ideal for CI pipelines and automation.

**Install via Cargo:**
```bash
cargo install --git https://github.com/dryotta/mdownreview.git --bin mdownreview-cli
```

**Or download prebuilt binaries** from the [Releases page](https://github.com/dryotta/mdownreview/releases/latest):

| Platform | Artifact |
|----------|----------|
| Windows x64 | `mdownreview-cli-x.x.x-windows-x64.exe` |
| Windows ARM64 | `mdownreview-cli-x.x.x-windows-arm64.exe` |
| macOS ARM64 | `mdownreview-cli-x.x.x-macos-arm64` |

**CLI subcommands:**
```bash
mdownreview-cli --help                         # aggregated help: top-level + every subcommand

# read — show review comments
mdownreview-cli read --folder .                                  # unresolved comments in folder
mdownreview-cli read --folder . --include-resolved               # include resolved comments
mdownreview-cli read --folder . --json                           # JSON envelope (array of {reviewFile,sourceFile,comments})
mdownreview-cli read --folder . --file foo.md                    # single source-or-sidecar file
mdownreview-cli read --file foo.md.review.yaml --json            # single file as JSON

# respond — add a response and/or mark resolved
mdownreview-cli respond path/to/file.md <comment-id> --response "Fixed"
mdownreview-cli respond path/to/file.md <comment-id> --resolve
mdownreview-cli respond path/to/file.md <comment-id> --response "Fixed" --resolve
mdownreview-cli respond --folder . rel/path/file.md <comment-id> --response "ack"

# cleanup — delete fully-resolved sidecars
mdownreview-cli cleanup --folder . --dry-run                     # preview deletions
mdownreview-cli cleanup --folder .                               # delete sidecars whose comments are all resolved
mdownreview-cli cleanup --folder . --include-unresolved          # also delete sidecars with unresolved comments
```

### Why isn't this app signed?

mdownreview is open-source and not signed with an Apple Developer ID. The app and CLI are ad-hoc signed, which means macOS shows a Gatekeeper warning on first launch when downloaded via a browser. The script install above avoids this entirely. See [docs/features/installation.md](docs/features/installation.md) for the full story (including how this differs from the auto-updater's minisign signature).

## Agent Skills

Install plugins for Claude, GitHub Copilot CLI, and other coding agents:

```text
/plugin marketplace add dryotta/mdownreview-skills
/plugin install mdownreview@mdownreview-skills
```

| Skill | Description |
|-------|-------------|
| `open` | Find, install, and launch the mdownreview desktop app |
| `read` | Scan for review sidecars and list unresolved comments |
| `review` | Orchestrate the full cycle — read, fix, and clean up |
| `cleanup` | Delete sidecar files where all comments are resolved |

## Updating

**App** — mdownreview checks for updates automatically on launch and installs them in the background. No action needed.

**Skills** — update to the latest version:
```text
/plugin update mdownreview-skills
```

## Building from Source

See [BUILDING.md](BUILDING.md).

## License

MIT — see [LICENSE](LICENSE)
