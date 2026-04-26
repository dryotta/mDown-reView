# Nielsen 10 — heuristics catalogue

Reference rule IDs cited by `test-exploratory-e2e` issue bodies. Each rule has a stable
ID; bug reports link to the section by anchor.

| ID | Heuristic | Detector |
|---|---|---|
| `NIELSEN-1`  | Visibility of system status | No spinner/skeleton within 250 ms after click that triggered IPC |
| `NIELSEN-2`  | Match real world | Vision-only |
| `NIELSEN-3`  | User control & freedom | Esc closes overlays; undo reachable for destructive actions |
| `NIELSEN-4`  | Consistency & standards | Same icon across screens for same action (anchor diff) |
| `NIELSEN-5`  | Error prevention | Destructive button has confirmation or undo |
| `NIELSEN-6`  | Recognition over recall | Visible labels for icon-only buttons |
| `NIELSEN-7`  | Flexibility & efficiency | Keyboard shortcut exists for primary action |
| `NIELSEN-8`  | Aesthetic & minimal | Vision-only |
| `NIELSEN-9`  | Error recovery | Error message offers next step, not raw stack |
| `NIELSEN-10` | Help & docs | Empty states have onboarding hint |

## NIELSEN-1 — Visibility of system status

The system should always keep users informed about what is happening.
Detector: when a click triggers an IPC `invoke()`, a loading affordance
(spinner, skeleton, disabled+aria-busy state) must be visible within 250 ms.

## NIELSEN-2 — Match real world

Use language and concepts familiar to the user. Vision-only — flagged by the
LLM-vision triage pass when copy uses jargon or developer-internal terms.

## NIELSEN-3 — User control & freedom

Provide clearly marked emergency exits. Detector: every overlay/modal closes on
`Escape`; destructive actions are reversible (undo) or confirmed.

## NIELSEN-4 — Consistency & standards

Same action should use the same icon and label across screens. Detector: same
heuristic action observed with diverging anchor strings is flagged.

## NIELSEN-5 — Error prevention

Detector: any element matching `delete|remove|clear` heuristics must require
confirmation OR provide an undo.

## NIELSEN-6 — Recognition over recall

Detector: icon-only buttons (`<button>` with no text content) must have an
accessible name (`aria-label` or `title`) that matches the visible icon meaning.

## NIELSEN-7 — Flexibility & efficiency

Detector: primary actions on a screen should be reachable via a keyboard
shortcut listed in the app's command map.

## NIELSEN-8 — Aesthetic & minimal

Vision-only. Flagged when the LLM-vision triage detects visual clutter,
unnecessary chrome, or competing focal points.

## NIELSEN-9 — Error recovery

Detector: error messages must include a next-step hint and must not surface a
raw stack trace, JSON blob, or untranslated error code (see also
`MDR-IPC-RAW-JSON-ERROR`).

## NIELSEN-10 — Help & docs

Detector: empty states (`.empty-state`, panels with no children) must include
an onboarding hint or call-to-action.
