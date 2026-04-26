# Retrospective — iterate-one-issue feature-issue-90-sticky-viewer-toolbar-iter-1 (PASSED)

<!-- retro-meta:
skill: iterate-one-issue
run:   feature-issue-90-sticky-viewer-toolbar-iter-1
outcome: PASSED
started: 2026-04-26T19:21:00Z
ended:   2026-04-26T19:55:00Z
-->

## Goal of this run
Satisfy all acceptance criteria of #90 — viewer toolbar must remain pinned to `.viewer-scroll-region` for the entire scroll length (rect-equality ±1 px at 5 checkpoints across markdown / source / mermaid modes; CSS-only fix; new browser Playwright spec; existing unit test still passes).

## What went well
- Groomed spec (issue #90 comment, post bug+performance+react+test panel revision) carried full RCA and unambiguous Direction A choice — implementation needed zero design decisions from the autonomous loop.
- Three-line CSS edit (commit 22d53fd) plus one focused browser spec covered all 5 acceptance criteria in a single iteration.
- Local validator caught the wrong mermaid selector (`pre.mermaid, .mermaid` → `.mermaid-view`) before CI did — saved a CI cycle. Fixed in 58f67b3.
- Local re-run of the spec also caught a per-test timeout from a too-large mermaid fixture (~9000 lines + react-markdown parse). Slim fixture in b0a7028 brought run time from 30s timeout to 26s for all 3 cases.
- Expert panel (8/8) returned APPROVE with concrete confirmation per area: bug-expert verified pre-fix CSS would have failed the test; architect-expert validated Direction A as lower-coupling than Direction B; test-expert verified all 11 canonical init commands explicitly mocked.
- CI was green on the third push (b0a7028) — Build (macos-arm64), Build (windows-x64), Test (Linux) all passed.

## What did not go well
- First spec author (this loop) guessed `pre.mermaid` as the mermaid selector instead of grepping for the actual class first. Cost one extra commit + one local validator run.
- First mermaid fixture was the same as the markdown fixture (`TALL_MD + block + TALL_MD` ≈ 9000 lines). The 30s page.evaluate timeout failure was vague enough that diagnosing "too much react-markdown to parse" required one round of local re-run.
- The validator agent reported the pre-existing native installer test failure (no NSIS bundle built) as `FAIL`; the skill rule says "if the binary required isn't built, report SKIPPED". Not blocking — but the validator's output schema and the rule wording diverge.

## Root causes of friction
- **Selector guessing instead of source lookup.** No skill-level guard requires the implementer to grep for a class before writing a selector-based assertion. This is a recurring pattern (cf. earlier exploratory tests).
- **Per-test budget for react-markdown is implicit.** No documented "max safe fixture size for a `MarkdownViewer` test" exists in `docs/test-strategy.md` or `docs/performance.md`. Authors discover the limit empirically.
- **Validator schema vs rule wording.** The exe-implementation-validator returns `PASS|FAIL|SKIPPED` per check, but the prompt rule "if binary not built, report SKIPPED" describes a specific *failure mode* and the validator's instinct is to mark the run FAIL because exit code was 1.

## Improvement candidates (each must be specifiable)

### Document maximum safe inline-generated markdown fixture size for browser specs
- **Category:** test-strategy
- **Problem (with evidence):** First mermaid case used a ~9000-line markdown fixture and hit the 30s `page.evaluate` timeout (`e2e/browser/viewer-toolbar-sticky.spec.ts:89`, "Test timeout of 30000ms exceeded"). Slimming to ~1600 lines fixed it. `docs/test-strategy.md` and `docs/performance.md` contain no rule about "fixture size budget for react-markdown specs", so authors discover the limit empirically each time.
- **Proposed change:** Add a rule under `docs/test-strategy.md` "Browser test patterns" along the lines of: *"Inline-generated markdown fixtures used to exercise scroll/sticky/layout behaviour SHOULD stay below ~3000 lines (≈ 350 KB rendered HTML) per `page.evaluate`-bound assertion. Larger fixtures risk hitting the 30s per-test budget on slow CI runners during react-markdown's initial parse pass. If a larger document is genuinely required, raise per-test timeout via `test.slow()` and document why."*
- **Acceptance signal:** Rule cited from `docs/test-strategy.md` in any future browser spec that uses `Array.from({ length: N })` markdown generation; new spec authors no longer rediscover the limit empirically.
- **Estimated size:** xs
- **Confidence this matters:** medium — react-markdown render cost is the documented gap in `docs/performance.md` ("MarkdownViewer re-parses…"), so a bounded recommendation aligned with it is cheap insurance for future browser specs.

### Tighten exe-implementation-validator → SKIPPED contract for missing native build artifact
- **Category:** agent
- **Problem (with evidence):** Validator iter-1 reported `playwright_native: FAIL` for the NSIS installer test (`e2e/native/installer.spec.ts:35`) even though the underlying error is "No NSIS bundle dir found" — i.e., the prerequisite artifact wasn't built. The skill instruction was *"if the binary required isn't built, report SKIPPED — don't try to build it from scratch unless the npm script does so itself"*, but the validator's `details` payload split the difference: `"summary": "exit 1 — 13 passed, 1 failed"` then `"note": "Reporting overall as FAIL because the run exit code was 1; treat as SKIPPED if installer artifact is out of scope."`
- **Proposed change:** Update the `exe-implementation-validator` agent definition (in `.claude/agents/exe-implementation-validator.md`) to define a precise rule: *"For each suite step, if the only failures are explicitly attributed to a missing prerequisite artifact (e.g. 'no NSIS bundle dir found', 'binary not present'), classify the step as SKIPPED with the missing-prerequisite reason in `details`, NOT FAIL. Failures from inside an artifact that exists remain FAIL."* Provide the NSIS case as an example.
- **Acceptance signal:** Future `iterate-one-issue` runs whose diff doesn't touch installer/CLI shim see `playwright_native: SKIPPED` in the validator output, not `FAIL`. This avoids the dispatcher having to manually decide whether the failure is in scope.
- **Estimated size:** xs
- **Confidence this matters:** medium — recurring noise pollutes the forward-fix loop's signal: the skill currently has to override the validator's verdict via `if the binary required isn't built, report SKIPPED` reasoning, and that happens every iter on every PR.

### Selector-source-of-truth lookup before authoring DOM assertions
- **Category:** skill
- **Problem (with evidence):** First mermaid-test attempt used `pre.mermaid, .mermaid` based on guess (commit 22d53fd), not on the actual mounted React component. Real selector is `.mermaid-view` (from `src/components/viewers/MermaidView.tsx:297`). The mistake cost one validator run + one fix commit (58f67b3). Same class of failure exists across other browser specs that hard-code class names without grepping first.
- **Proposed change:** Add a step to `iterate-one-issue` Step 5 (Implement) for any *new* browser spec: *"For each DOM selector used in a Playwright assertion, verify the class/test-id exists in the source by `grep -rn 'classname'` in `src/components/`. Cite the source line in a comment beside the selector."* Either as a Step-5 sub-bullet, or as a check the implementer agent performs and reports.
- **Acceptance signal:** New browser specs include source-citation comments for every assertion selector; selector-mismatch failures during validation drop near zero.
- **Estimated size:** s
- **Confidence this matters:** low/medium — the selector-guess pattern is real but rare; cost is one extra validator round when it happens. Worth fixing if it recurs in the next 2-3 runs.

## Carry-over to the next run
- None. Iteration 1 satisfied all 5 acceptance criteria; iteration 2 should re-assess to `achieved` and trigger Done-Achieved.

## BUG_RCA
The full root-cause analysis was already performed during issue grooming (post-bug-expert + post-perf-expert revision visible in the spec body of issue #90). The autonomous loop did not re-run `bug-expert` for iteration 1 because the spec carried the verbatim RCA and Direction A vs B trade-off. Pre-loop assessment matched the spec's diagnosis exactly: sticky containing block (`.enhanced-viewer`/`.markdown-viewer`/`.source-view`) was capped at one viewport of `.viewer-scroll-region` via `height: 100%`, so once content overflowed, the containing block scrolled past `top: 0` and the sticky toolbar followed. Fix: `min-height: 100%` on those three selectors. Regression test fails on pre-fix CSS at every checkpoint where `ratio > 0`.
