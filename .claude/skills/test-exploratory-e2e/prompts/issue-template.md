## Heuristic
**MDR-IPC-RAW-JSON-ERROR** — Raw error JSON leaks into UI
(see `.claude/skills/test-exploratory-e2e/heuristics/mdownreview-specific.md`)

## Severity
**P1**

## Reproduction
1. Open folder with no read permission
2. Click any file in the folder
3. Observe the error banner

## Evidence
![step-17](attachments/step-17.png)

**DOM anchor:** `div.error-banner`
**Console:** `Failed to invoke read_text_file: {"kind":"io","message":"Permission denied"}`
**A11y:** banner has accessible name `'{"kind":"io","message":"Permission denied"}'`

## Suggested direction
Add a `formatFsError()` analogous to `formatOnboardingError` (`src/store/index.ts:399-411`)
that exhaustively switches on `kind` for the `read_*` commands.
Out of scope for this skill to implement.

## Run
explore-ux run id: `2026-04-25-22-30`, step 17
Reproduced 3× since 2026-04-20.
