# WCAG 2.1 AA + 2.2 — heuristics catalogue (high-yield subset)

Reference rule IDs cited by `test-exploratory-e2e` issue bodies. Note `WCAG-2.5.8`
(Target Size Minimum) is the AA-level WCAG 2.2 successor to 2.5.5
(Target Size, AAA). The runner cites 2.5.8.

| ID | Rule | Detector |
|---|---|---|
| `WCAG-1.4.3`  | Contrast 4.5:1 text | axe-core algorithm on computed styles |
| `WCAG-1.4.11` | Non-text contrast 3:1 | Borders, focus rings |
| `WCAG-2.1.1`  | Keyboard accessible | Every interactive reachable via Tab |
| `WCAG-2.4.3`  | Focus order | Tab order matches visual order |
| `WCAG-2.4.7`  | Focus visible | Outline ≠ none with no replacement |
| `WCAG-2.5.8`  | Target size minimum (≥ 24×24 CSS px, WCAG 2.2 AA) | Bounding-box check |
| `WCAG-4.1.2`  | Name/role/value | a11y-tree node has accessible name |

## WCAG-1.4.3 — Contrast (Minimum)

Text and images of text must have a contrast ratio of at least 4.5:1 (3:1 for
large text ≥ 18 pt or 14 pt bold). Detector: computed-style sampling using the
axe-core contrast algorithm.

## WCAG-1.4.11 — Non-text Contrast

Visual presentation of UI components and graphical objects must have contrast
ratio of at least 3:1 against adjacent colours. Detector: borders, focus rings.

## WCAG-2.1.1 — Keyboard

All functionality must be operable through a keyboard interface. Detector:
synthetic Tab walk reaches every interactive element.

## WCAG-2.4.3 — Focus Order

Focus order preserves meaning and operability. Detector: Tab traversal order
matches the visual top-to-bottom / left-to-right reading order.

## WCAG-2.4.7 — Focus Visible

Any keyboard-operable user interface has a mode of operation where the focus
indicator is visible. Detector: computed `outline-style` ≠ `none` OR a
replacement focus ring is detected.

## WCAG-2.5.8 — Target Size (Minimum) — WCAG 2.2 AA

The size of the target for pointer inputs is at least 24 × 24 CSS pixels
(except inline, user-agent, essential, and equivalent exceptions). Detector:
bounding-box check on interactive elements.

## WCAG-4.1.2 — Name, Role, Value

For all UI components, the name and role can be programmatically determined.
Detector: every accessibility-tree node with a non-presentational role has a
non-empty accessible name.
