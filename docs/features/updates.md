# Auto-Update

## What it is

mdownreview ships with two release channels: **stable** (default) and **canary** (pre-release opt-in). The updater checks for a new signed build on startup, announces updates in the UI, and installs them on user approval. Channel selection is a client-side toggle — the user can switch at any time without reinstalling.

## How it works

The update path uses the official Tauri updater plugin with signed-build verification. Channel detection is driven by the pre-release suffix of the current version (e.g., `-canary.3`) rather than a `-canary` substring — this keeps MSI packaging happy on Windows while still correctly identifying the channel.

Check logic is offline-tolerant: a failed check logs and backs off; it never blocks startup or pops a modal. The `updateSlice` carries update state into React; the About dialog and the status bar read from it. Downloads and installs are gated on explicit user action.

Release CI produces one installer per channel per platform; the GitHub release that matches the current channel is the update source.

```mermaid
flowchart TD
    Start(["app startup"]) --> Detect["detect channel<br/>from pre-release suffix<br/>(stable / canary)"]
    Detect --> Check{"check signed release<br/>for current channel"}
    Check -- "offline / network error" --> Backoff["log + back off<br/>never modal, never blocks UI"]
    Check -- "up to date" --> Idle["updateSlice idle<br/>About dialog shows OK"]
    Check -- "newer signed build" --> Notify["updateSlice → status bar<br/>+ About dialog announce"]
    Notify --> Action{"user clicks install?"}
    Action -- "no" --> Idle
    Action -- "yes" --> DL["download artifact<br/>verify minisign signature"]
    DL --> Install["install + restart"]
    Backoff --> Idle
```

## Key source

- **Rust:** `src-tauri/src/update.rs`, `src-tauri/src/lib.rs` (plugin registration)
- **Frontend:** `updateSlice` in `src/store/index.ts`
- **UI:** `src/components/AboutDialog.tsx`
- **CI:** release workflow files under `.github/workflows/` (triggered by the `/publish-release` skill)

## Related rules

- Offline tolerance + no modal on failed check — [`docs/principles.md`](../principles.md) Reliable pillar.
- Signed-build verification is MANDATORY (never ship an unsigned updater path) — [`docs/security.md`](../security.md).
- Canary-channel detection rule (numeric-only pre-release suffix) — see commit history on `feat: canary release pipeline` + follow-up `fix: detect canary channel by pre-release suffix` for the concrete regression we avoid.
- Lean pillar: the updater is not a telemetry surface — no analytics, no health pings beyond the single version-check GET. [`docs/principles.md`](../principles.md) Non-Goals.
