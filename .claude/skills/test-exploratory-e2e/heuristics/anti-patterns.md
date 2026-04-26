# Anti-patterns — heuristics catalogue

Generic AI-aesthetic and cargo-cult patterns flagged by the runner (DOM-based
detectors) and the LLM-vision triage pass (visual detectors).

| ID | Symptom |
|---|---|
| `AP-GENERIC-AI-AESTHETIC` | Generic SaaS blue + purple gradients (vision-flagged) |
| `AP-LIQUID-GLASS` | `backdrop-filter: blur(...)` on flat-design app |
| `AP-EMOJI-AS-ICON` | DOM scan for emoji in `<button>` lacking icon component |
| `AP-DEAD-AFFORDANCE` | `cursor:pointer` element with no handler bound |

## AP-GENERIC-AI-AESTHETIC

Vision-only. Flagged when the LLM-vision triage detects the generic
"AI-startup" gradient palette (blue → purple, cyan → pink) on chrome that
should feel utilitarian.

## AP-LIQUID-GLASS

Detector: any computed `backdrop-filter` containing `blur(` on an element
inside the application chrome. mdownreview is an explicitly flat-design viewer
(see `docs/principles.md`); glass surfaces are an anti-pattern here.

## AP-EMOJI-AS-ICON

Detector: scan `<button>` text content for emoji code points (Unicode
categories So / Sk / surrogate pairs in the supplementary plane) when no
sibling icon component is present. Emojis as primary icons are inconsistent
across platforms and accessibility tooling.

## AP-DEAD-AFFORDANCE

Detector: any element with computed `cursor: pointer` that has no `onClick`
handler attached and no parent within 3 ancestors with a handler. Indicates a
clickable affordance the user will try and that does nothing.
