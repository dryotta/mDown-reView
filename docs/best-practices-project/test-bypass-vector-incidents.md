---
tags: [test]
---

# Bypass-vector enumeration — worked examples (mdownreview)

Project-specific worked examples of the **bypass-vector enumeration** pattern that `test-expert` (`.claude/agents/test-expert/agent.md`) checks on source-byte regression guards.

## Worked example — PR #323, Rule-26 log-rotation guard

The original guard used the year-prefix needle `"<prefix>.20"` to forbid hand-built fixture literals against `tauri-plugin-log`'s rotation filenames. `rubber-duck` red-teamed three bypass vectors the test-expert pre-consult had missed:

1. **Constant-interpolation bypass** — `format!("{FILE_PREFIX}.{stamp}{FILE_SUFFIX}")` reconstructs the filename without the literal `<prefix>.20...` ever appearing in source.
2. **Non-year literal bypass** — `"mdownreview.placeholder.log"` matches the rotation filename shape but has no `20` year prefix.
3. **Concat reconstruction** — `[FILE_PREFIX, ".", &stamp, FILE_SUFFIX].concat()` (or `.join("")`) builds the same string from pieces.

Forward-fix `9d663d8` adopted vectors 1 and 2 by adding the placeholder needle pair `format!("<prefix>.{` / `format!("<prefix>_{`. Catching these at pre-consult time would have saved one forward-fix iteration.

## Lesson

A `contains("literal")` guard is only as strong as its needle set against an adversary who can:
- Reconstruct strings from constants (`format!`, concat).
- Substitute a different literal that satisfies the same shape contract.
- Build the string at runtime from values not visible in source.

For each new source-byte guard added in this repo, the patch author MUST submit an enumerated bypass-vector list following the template in `test-expert/agent.md` Always-check.

## Origin

This pattern was adopted in mdownreview after the iter-pre-consult miss documented in PR #323. Per issue #331.
