# Must-Acknowledge Banner Pattern (mdownreview-specific)

> **Cite as:** `pattern: must-acknowledge-banner in docs/best-practices-project/must-acknowledge-banner.md`.

A pattern doc derived from the iter-21 retrospective's §4.3 finding (`docs/retrospectives/2026-05-03-352-data-loss-class.md`). Source-of-truth for any banner that signals an **unsafe** product state in mdownreview — autosave paused, save failed, conflict pending, library version mismatch — and the parallel side of [rule 33 in `docs/architecture.md`](../architecture.md) (single-source ref) on the data side.

## Trigger

Use this pattern when you are adding any non-modal banner whose underlying invariant is **user-data-affecting and unrecoverable-by-time**. Concretely: a state where the user *needs* to make a choice, and where waiting / dismissing without choosing means lost bytes, stale content, or a silent fallthrough to a default that may not be what the user wanted.

Triggers in this codebase:

- Autosave loop paused after N consecutive failures.
- External file change while the renderer holds dirty edits.
- Save IPC failure with retryable cause (workspace allowlist, size cap).
- A close-flush handshake that timed out with at least one path's bytes unflushed.
- Library version mismatch on `.excalidrawlib` (proposed; not yet shipped).

Triggers OUT of scope (use a regular dismissible toast / status badge):

- Informational disclosure (first-time user education — the once-per-profile `FirstEntryBanner` is correctly auto-dismissable because the underlying state is *informational*, not unsafe).
- Transient confirmations ("Saved" pill, "Copied to clipboard" toast).
- Status indication that has no required user action (`SaveStatusIndicator`'s `saved` / `unsaved` / `saving` states; `failed` and `paused` borrow this pattern).

## Rule

**Banners that signal an unsafe state MUST require explicit user acknowledgment to dismiss; auto-dismissal silently hides the failure.** Concretely:

1. **No `Dismiss` button while the underlying invariant is unsafe.** The user's only ways out are the **action** buttons (`Resume`, `Reload`, `Keep my edits`, `Retry`) — each of which transitions the state machine to a different state, NOT to "banner gone, problem still there."
2. **Asymmetric button styling between safe and unsafe choices.** A binary destructive choice (Reload-and-discard vs Keep-my-edits-and-overwrite) renders the safer one as the visual default (filled / primary) and the destructive one as outlined-destructive. The user cannot mistake the irreversible option for the safer one because the more-reassuring text is on the safer button.
3. **Persistent across rerenders.** The banner does not animate out, fade, or auto-hide on a timer. It stays on-screen until the user clicks an action button.
4. **Single visual identity per state.** Two semantically-distinct states (e.g. "save failed but auto-retry will keep trying" vs "save failed and we have stopped trying") render with different copy AND different available actions — never the same visual with a different value flag.

## Canonical example

`src/components/viewers/excalidraw/ExcalidrawBanners.tsx`'s `SaveErrorBanner` (`:127-180`).

In the **recoverable-error** state (`paused === false`):
```tsx
<SaveErrorBanner paused={false} message="…" onRetry={…} onDismiss={…} />
```
Renders both `Retry` and `Dismiss`. The autosave loop is still alive; dismissing closes the banner without harming the invariant — the next user edit re-arms the loop.

In the **failure-paused** state (`paused === true`, after 3 consecutive failures):
```tsx
<SaveErrorBanner paused={true} message="…" onRetry={…} onDismiss={…} />
```
The component **does not render the Dismiss button at all**:
```tsx
{!paused && (
  <button onClick={onDismiss}>Dismiss</button>
)}
```
The only path forward is `Resume` (which clears the failure counter and re-engages the loop) or fixing the underlying disk problem and trying again. Without this guard a user could silently dismiss a paused autosave banner, keep editing for an hour, and lose every keystroke when they close the tab.

The pre-iter-21 banner shipped a `Dismiss` button identically in both states. Iter-21 P0-3 closed it (retro #26 — "dismiss-during-pause looked like a closure"). The iter-22 expert review rated this fix as the structural test for whether *every other* banner in the codebase obeys the same pattern.

## Anti-pattern

**Identical button affordances in safe and unsafe states.** A banner that renders `[Reload]` and `[Keep my edits]` with the same colour, the same border style, and the same font weight cannot tell the user which one is destructive. The user makes the destructive choice by accident. (Iter-22 P0-4 — `ConflictBanner` pre-fix.)

**Auto-dismissal of unsafe states.** A toast that surfaces "save failed" and slides off-screen after 4 s is the same as not telling the user at all — the failure leaves no trace and the user keeps editing on top of stale bytes.

**Hiding the unsafe state in a tooltip / status pill subtree.** If the user has to hover a status indicator to discover the underlying problem, they will not discover it. Surface unsafe states as banner-level UI; reserve subtle indicators for `saved` / `dirty` / `saving` (the safe states).

## Test pattern

Every banner in `src/components/viewers/.../*Banners.tsx` (or equivalent) needs both shape tests AND state-machine assertions:

```tsx
// Shape: the unsafe state hides Dismiss
it("paused state hides Dismiss — autosave-loop halted requires explicit ack", () => {
  render(<SaveErrorBanner paused={true} message="…" onRetry={…} onDismiss={…} />);
  expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
  expect(screen.getByText("Resume")).toBeInTheDocument();
});

// Shape: the safe state renders both
it("recoverable error state renders Retry + Dismiss — loop is still alive", () => {
  render(<SaveErrorBanner paused={false} message="…" onRetry={…} onDismiss={…} />);
  expect(screen.getByText("Retry")).toBeInTheDocument();
  expect(screen.getByText("Dismiss")).toBeInTheDocument();
});

// State machine: no transition leaves the invariant unsafe AND the banner hidden
it("dismiss while paused: state machine has no such edge", () => {
  // Either the pre-condition `paused === true` AND the dismiss callback is
  // unreachable (no button rendered), or there is an explicit `Resume` step
  // between paused → dismissed. Anything else is a regression.
});
```

Stricter cross-cutting assertion (proposed; not yet shipped as a lint rule): for every banner component file, scan for a JSX literal containing the string `"Dismiss"` — assert it is gated by a falsy boolean expression that names an unsafe-state flag. (`{!paused && …}`, `{recoverable && …}`.) An ungated `<button>Dismiss</button>` in a banner that also renders unsafe-state copy is a code-review smell.

## Related

- [Rule 33 in `docs/architecture.md`](../architecture.md) — Single-source ref. The data-side parallel: refs that determine "what's the truth" must cite their source surface; banners that determine "is the truth safe right now" must require acknowledgment.
- `docs/principles.md` Reliable pillar — every byte the user has authored must survive the choices the banner forces.
- `docs/principles.md` Excalidraw carve-out — must-acknowledge banner is one of four shipped requirements for the editor-grade reliability contract.
- `docs/retrospectives/2026-05-03-352-data-loss-class.md` §4.3 — pattern derivation; §1 row #26 — the bug whose fix this pattern documents.
